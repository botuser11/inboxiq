from fastapi import APIRouter
from pydantic import BaseModel
from services.nemotron import call_nemotron
from datetime import datetime

router = APIRouter()

class DraftRequest(BaseModel):
    email_body: str
    tone: str = "professional"

@router.post("/draft")
def draft_reply(req: DraftRequest):
    current_date = datetime.now().strftime("%A, %d %B %Y")
    prompt = f"""Today's date is {current_date}. Never reference dates in the past.
Write a reply to this email in a {req.tone} tone.
Be concise, natural and helpful. Do not include a subject line.
Just write the reply body, ready to send.

Original email:
{req.email_body}

Reply:"""
    draft = call_nemotron(prompt)
    return {"draft": draft}