from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import analyse, summarise, triage, label, draft

app = FastAPI(title="InboxIQ API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyse.router)
app.include_router(summarise.router)
app.include_router(triage.router)
app.include_router(label.router)
app.include_router(draft.router)

@app.get("/")
def root():
    return {"status": "InboxIQ API is running"}