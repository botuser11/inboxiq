from fastapi import APIRouter
from pydantic import BaseModel
from services.nemotron import call_nemotron
from datetime import datetime
import json

router = APIRouter()

class EmailRequest(BaseModel):
    email_body: str

@router.post("/triage")
def triage_email(req: EmailRequest):
    now = datetime.now()
    current_weekday = now.strftime("%A")
    current_date = now.strftime("%Y-%m-%d")
    current_time = now.strftime("%H:%M")

    prompt = f"""Today is {current_weekday}, {current_date} and the current time is {current_time}.

Analyse this email. Respond ONLY with valid JSON, no other text:
{{
  "priority": "High, Medium, or Low based on content importance",
  "dates_found": ["YYYY-MM-DD HH:MM format, convert relative dates like 'tomorrow', 'Friday', 'next week' to actual dates using today's date"],
  "has_deadline": true or false
}}

High = urgent, needs immediate action
Medium = needs action but not urgent
Low = informational, no action needed

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
        priority = ai.get("priority", "Medium")
        if priority not in ["High", "Medium", "Low"]:
            priority = "Medium"

        dates_found = ai.get("dates_found", [])
        priority_reason = ""

        # Find nearest future date
        nearest = None
        for d in dates_found:
            try:
                parsed = datetime.strptime(d, "%Y-%m-%d %H:%M")
                if parsed > now:
                    if nearest is None or parsed < nearest:
                        nearest = parsed
            except ValueError:
                continue

        if nearest:
            delta = nearest - now
            hours = delta.total_seconds() / 3600
            days = delta.days

            if hours <= 24:
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

        return {"priority": priority, "priority_reason": priority_reason}

    except (json.JSONDecodeError, Exception):
        # Fallback: simple prompt
        fallback_prompt = f"""Analyse this email and assign a priority level.
Reply with ONLY one word: High, Medium, or Low.

High = urgent, needs immediate action
Medium = needs action but not urgent
Low = informational, no action needed

Email:
{req.email_body}

Priority:"""
        priority = call_nemotron(fallback_prompt).strip()
        if priority not in ["High", "Medium", "Low"]:
            priority = "Medium"
        return {"priority": priority, "priority_reason": ""}
