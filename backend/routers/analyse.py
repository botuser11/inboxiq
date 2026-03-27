from fastapi import APIRouter
from pydantic import BaseModel
from services.nemotron import call_nemotron
from datetime import datetime
import json

router = APIRouter()

class EmailRequest(BaseModel):
    email_body: str
    thread_context: str = None

class BatchEmail(BaseModel):
    id: str
    subject: str
    snippet: str = ""

class BatchEmailRequest(BaseModel):
    emails: list[BatchEmail]

@router.post("/analyse")
def analyse_email(req: EmailRequest):
    now = datetime.now()
    current_weekday = now.strftime("%A")
    current_date = now.strftime("%Y-%m-%d")
    current_time = now.strftime("%H:%M")

    json_schema = """{
  "summary": "Start with the sender's name. Summarise in 2-3 sentences what they want and any action needed.",
  "priority": "High, Medium, or Low based on content importance",
  "label": "Classify using these rules: Work = emails from colleagues/managers about tasks, projects, meetings, deadlines. Finance = bank statements, invoices, payment confirmations, tax documents. Newsletter = marketing emails, job alerts, platform updates, promotional content, subscription emails, unsubscribe links present. Personal = emails from friends/family, personal matters. Social = social media notifications (LinkedIn, Twitter, Facebook, Instagram). Promotions = sales, discounts, offers, coupons. Updates = shipping updates, account notifications, security alerts, app updates. Key rule: If the email has an Unsubscribe link or comes from a no-reply/marketing address, it is almost always Newsletter or Promotions, NOT Work. Reply with only the label name.",
  "dates_found": [{"date": "YYYY-MM-DD HH:MM", "description": "brief description of what is due"}],
  "has_deadline": true or false
}"""

    priority_rules = """High = urgent action needed from YOU specifically, with real consequences if delayed (e.g. your manager asking for something, a client deadline, a meeting you must attend)
Medium = requires action but not time-sensitive (e.g. a task to complete this week, a question to answer)
Low = informational only, no action needed from you (e.g. newsletters, job alerts, promotional emails, automated notifications, subscription updates, marketing emails)
Important: Newsletters, job postings, promotional emails, and automated marketing must ALWAYS be Low priority regardless of urgency language like "apply now" or "limited time"."""

    thread_json_schema = """{
  "summary": "Start with the sender's name. Summarise in 2-3 sentences what they want and any action needed.",
  "priority": "High, Medium, or Low based on content importance",
  "label": "Classify using these rules: Work = emails from colleagues/managers about tasks, projects, meetings, deadlines. Finance = bank statements, invoices, payment confirmations, tax documents. Newsletter = marketing emails, job alerts, platform updates, promotional content, subscription emails, unsubscribe links present. Personal = emails from friends/family, personal matters. Social = social media notifications (LinkedIn, Twitter, Facebook, Instagram). Promotions = sales, discounts, offers, coupons. Updates = shipping updates, account notifications, security alerts, app updates. Key rule: If the email has an Unsubscribe link or comes from a no-reply/marketing address, it is almost always Newsletter or Promotions, NOT Work. Reply with only the label name.",
  "dates_found": "Extract ALL dates and deadlines from the ENTIRE conversation thread (not just the latest message). Include deadlines from earlier messages too. Return as array of objects: [{\\"date\\": \\"YYYY-MM-DD HH:MM\\", \\"description\\": \\"brief description of what's due\\"}]",
  "has_deadline": true or false
}"""

    if req.thread_context:
        prompt = f"""Today is {current_weekday}, {current_date} and the current time is {current_time}.

This email is part of a conversation thread. Here is the full thread context:

{req.thread_context}

The LATEST message (the one to analyse) is:
{req.email_body}

Analyse the LATEST message with full awareness of the conversation history.
Consider: what decisions were made earlier, what's being followed up on, and what new action is needed.

IMPORTANT: Scan ALL messages in the thread for dates and deadlines, not just the latest one. Earlier messages often contain the original deadlines that are still relevant.

Respond ONLY with valid JSON, no other text:
{thread_json_schema}

{priority_rules}"""
    else:
        prompt = f"""Today is {current_weekday}, {current_date} and the current time is {current_time}.

Analyse this email and respond ONLY with valid JSON, no other text:
{json_schema}

{priority_rules}

Email:
{req.email_body}"""

    raw = call_nemotron(prompt).strip()

    # Clean markdown backticks if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    try:
        ai = json.loads(raw)

        summary = ai.get("summary", "")
        priority = ai.get("priority", "Medium")
        label = ai.get("label", "Work")
        dates_found = ai.get("dates_found", [])

        if priority not in ["High", "Medium", "Low"]:
            priority = "Medium"

        valid_labels = ["Work", "Finance", "Newsletter", "Personal", "Social", "Promotions", "Updates"]
        if label not in valid_labels:
            label = "Work"

        # Parse dates_found — support both object and string formats
        parsed_dates = []
        for d in dates_found:
            try:
                if isinstance(d, dict):
                    dt = datetime.strptime(d["date"], "%Y-%m-%d %H:%M")
                    parsed_dates.append({"dt": dt, "description": d.get("description", "")})
                else:
                    dt = datetime.strptime(d, "%Y-%m-%d %H:%M")
                    parsed_dates.append({"dt": dt, "description": ""})
            except (ValueError, KeyError):
                continue

        # Build upcoming_deadlines list (all dates, past and future)
        upcoming_deadlines = [
            {"date": p["dt"].strftime("%Y-%m-%d %H:%M"), "description": p["description"]}
            for p in sorted(parsed_dates, key=lambda x: x["dt"])
        ]

        # Date-boosting logic using nearest future date
        priority_reason = ""
        future_dates = [p for p in parsed_dates if p["dt"] > now]
        past_dates = [p for p in parsed_dates if p["dt"] <= now]

        nearest = min(future_dates, key=lambda x: x["dt"]) if future_dates else None

        if nearest:
            delta = nearest["dt"] - now
            hours = delta.total_seconds() / 3600
            days = delta.days

            if hours <= 0:
                priority_reason = "Deadline passed!"
            elif hours <= 24:
                priority = "High"
                priority_reason = f"Deadline in {int(hours)} hours"
            elif days <= 2:
                priority = "High"
                priority_reason = f"Deadline in {days} days"
            elif days <= 7:
                if priority == "Low":
                    priority = "Medium"
                elif priority == "Medium":
                    priority = "High"
                priority_reason = f"Deadline in {days} days"
        elif past_dates and not future_dates and parsed_dates:
            priority_reason = "Deadline passed!"

        return {
            "summary": summary,
            "priority": priority,
            "priority_reason": priority_reason,
            "upcoming_deadlines": upcoming_deadlines,
            "label": label
        }

    except (json.JSONDecodeError, Exception):
        # Fallback: 3 separate calls
        from routers.summarise import summarise_email, EmailRequest as SumReq
        from routers.triage import triage_email, EmailRequest as TriReq
        from routers.label import label_email, EmailRequest as LabReq

        summary = summarise_email(SumReq(email_body=req.email_body)).get("summary", "")
        priority = triage_email(TriReq(email_body=req.email_body)).get("priority", "Medium")
        label = label_email(LabReq(email_body=req.email_body)).get("label", "Work")

        return {
            "summary": summary,
            "priority": priority,
            "priority_reason": "",
            "label": label
        }


@router.post("/batch-analyse")
def batch_analyse(req: BatchEmailRequest):
    emails = req.emails[:15]  # cap at 15
    now = datetime.now()
    current_weekday = now.strftime("%A")
    current_date = now.strftime("%Y-%m-%d")
    current_time = now.strftime("%H:%M")

    email_list = "\n".join([
        f"{i+1}. Subject: {e.subject}\n   Preview: {e.snippet[:200]}"
        for i, e in enumerate(emails)
    ])

    prompt = f"""Today is {current_weekday}, {current_date} and the current time is {current_time}.

Analyse each email below. Respond ONLY with a valid JSON array, no other text.

Priority rules:
High = urgent action needed from YOU specifically, with real consequences if delayed (manager asking for something, client deadline, meeting you must attend)
Medium = requires action but not time-sensitive (task to complete this week, question to answer)
Low = informational only, no action needed (newsletters, job alerts, promotions, automated notifications, subscription updates, marketing)
Important: Newsletters, job postings, promotional emails, and automated marketing must ALWAYS be Low.

Label rules — reply with ONLY the label name, one of: Work, Finance, Newsletter, Personal, Social, Promotions, Updates
Work = colleagues/managers, tasks/projects/meetings. Finance = bank/invoices/payments. Newsletter = marketing, job alerts, subscription content. Personal = friends/family. Social = LinkedIn/Twitter/Facebook/Instagram. Promotions = sales/discounts/offers. Updates = shipping/account notifications/security alerts.
Key rule: If the email has an Unsubscribe link or comes from a no-reply/marketing address, it is almost always Newsletter or Promotions, NOT Work.

Emails:
{email_list}

Respond with ONLY this JSON array:
[
  {{"index": 1, "priority": "High/Medium/Low", "label": "Work/Finance/Newsletter/Personal/Social/Promotions/Updates"}},
  ...
]"""

    raw = call_nemotron(prompt).strip()

    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    valid_priorities = ["High", "Medium", "Low"]
    valid_labels = ["Work", "Finance", "Newsletter", "Personal", "Social", "Promotions", "Updates"]
    results = []

    try:
        ai_results = json.loads(raw)
        for item in ai_results:
            idx = item.get("index", 0) - 1
            if 0 <= idx < len(emails):
                priority = item.get("priority", "Medium")
                label = item.get("label", "Work")
                if priority not in valid_priorities:
                    priority = "Medium"
                if label not in valid_labels:
                    label = "Work"
                results.append({
                    "id": emails[idx].id,
                    "priority": priority,
                    "priority_reason": "",
                    "label": label
                })
    except (json.JSONDecodeError, Exception):
        for email in emails:
            results.append({
                "id": email.id,
                "priority": "Medium",
                "priority_reason": "",
                "label": "Work"
            })

    return {"results": results}
