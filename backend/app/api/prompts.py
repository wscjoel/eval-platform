"""提示词模板 CRUD 路由。"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import PromptTemplate
from ..schemas import PromptTemplateCreate, PromptTemplateOut, PromptTemplateUpdate

router = APIRouter(prefix="/api/prompts", tags=["prompts"])


def _by_name(db: Session, name: str) -> PromptTemplate | None:
    return db.execute(select(PromptTemplate).where(PromptTemplate.name == name)).scalar_one_or_none()


@router.get("", response_model=list[PromptTemplateOut])
def list_prompts(db: Session = Depends(get_session)):
    rows = db.execute(select(PromptTemplate).order_by(desc(PromptTemplate.updated_at))).scalars().all()
    return [PromptTemplateOut.model_validate(r) for r in rows]


@router.post("", response_model=PromptTemplateOut)
def create_prompt(payload: PromptTemplateCreate, db: Session = Depends(get_session)):
    if _by_name(db, payload.name):
        raise HTTPException(409, f"name already exists: {payload.name}")
    p = PromptTemplate(**payload.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return PromptTemplateOut.model_validate(p)


@router.get("/{prompt_id}", response_model=PromptTemplateOut)
def get_prompt(prompt_id: int, db: Session = Depends(get_session)):
    p = db.get(PromptTemplate, prompt_id)
    if p is None:
        raise HTTPException(404, "prompt not found")
    return PromptTemplateOut.model_validate(p)


@router.put("/{prompt_id}", response_model=PromptTemplateOut)
def update_prompt(prompt_id: int, payload: PromptTemplateUpdate, db: Session = Depends(get_session)):
    p = db.get(PromptTemplate, prompt_id)
    if p is None:
        raise HTTPException(404, "prompt not found")

    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] and data["name"] != p.name:
        if _by_name(db, data["name"]):
            raise HTTPException(409, f"name already exists: {data['name']}")

    for k, v in data.items():
        if v is not None:
            setattr(p, k, v)
    p.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(p)
    return PromptTemplateOut.model_validate(p)


@router.delete("/{prompt_id}")
def delete_prompt(prompt_id: int, db: Session = Depends(get_session)):
    p = db.get(PromptTemplate, prompt_id)
    if p is None:
        raise HTTPException(404, "prompt not found")
    db.delete(p)
    db.commit()
    return {"ok": True}
