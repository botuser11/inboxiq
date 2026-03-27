from fastapi import APIRouter
from pydantic import BaseModel
from services.nemotron import call_nemotron
router = APIRouter()

class EmailRequest(BaseModel):
    email_body: str

@router.post("/summarise")
def summarise_email(req: EmailRequest):
    prompt = f"""Summarise this email in 2-3 sentences. Be concise and clear.

Email:
{req.email_body}

Summary:"""
    summary = call_nemotron(prompt)
    return {"summary": summary}