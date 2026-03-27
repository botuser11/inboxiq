from fastapi import APIRouter
from pydantic import BaseModel
from services.nemotron import call_nemotron
router = APIRouter()

class EmailRequest(BaseModel):
    email_body: str

@router.post("/label")
def label_email(req: EmailRequest):
    prompt = f"""Categorise this email into exactly one label.
Reply with ONLY one word from this list:
Work, Finance, Personal, Newsletter, Support, Spam
Email:
{req.email_body}

Label:"""
    label = call_nemotron(prompt).strip()
    valid = ["Work", "Finance", "Personal", "Newsletter", "Support", "Spam"]
    if label not in valid:
        label = "Work"
    return {"label": label}