"""Daily Dynasty — small-group authenticated daily puzzle league.

Run: uvicorn app.main:app --host 0.0.0.0 --port 8000
All persistent data lives under DD_DATA_DIR (mount a durable volume in production).
"""
from __future__ import annotations

import hashlib
import hmac
import io
import json
import os
import re
import secrets
import sqlite3
import time
import uuid
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, date, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Request, Response, HTTPException, UploadFile, File, Depends
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from PIL import Image, ImageOps, UnidentifiedImageError

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("DD_DATA_DIR", str(ROOT / "data"))).resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)
AVATAR_DIR = DATA_DIR / "avatars"
AVATAR_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "dynasty.sqlite3"
EASTERN = ZoneInfo("America/New_York")
SESSION_AGE = 60 * 60 * 24 * 30
SECURE_COOKIES = os.getenv("DD_SECURE_COOKIES", "0") == "1"
INVITE_CODE = os.getenv("DD_INVITE_CODE", "")

# Raw game scores aren't directly comparable; the client calculates league-relative
# player ratings and percentiles. Globle is the only lower-is-better game.
GAMES = [
    {"id":"krillion","name":"Krillion","direction":"high","min":0,"max":700,"unit":"pts","url":"https://krillion.io/"},
    {"id":"plain","name":"Plain","direction":"high","min":0,"max":10000,"unit":"m","url":"https://playplain.app/"},
    {"id":"factmap","name":"FactMap","direction":"high","min":0,"max":5000,"unit":"pts","url":"https://factmap.world/"},
    {"id":"farflung","name":"Farflung","direction":"high","min":0,"max":500,"unit":"km","url":"https://farflung.game/"},
    # The requested Perceptle.com five-test score is the rounded average out of 100.
    {"id":"perceptle","name":"Perceptle","direction":"high","min":0,"max":100,"unit":"pts","url":"https://perceptle.com/"},
    {"id":"globle","name":"Globle","direction":"low","min":1,"max":200,"unit":"guesses","url":"https://globle-game.com/"},
    {"id":"wonderhop","name":"Wonderhop","direction":"high","min":0,"max":2800,"unit":"pts","url":"https://wonderhop.io/"},
]
GAME_MAP = {g["id"]: g for g in GAMES}
WONDERHOP_MODES = ("sky", "abyss", "past", "future")
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.\-]{1,21}$")


def connection():
    con = sqlite3.connect(str(DB_PATH), timeout=15)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    con.execute("PRAGMA busy_timeout=15000")
    return con


@contextmanager
def db():
    con = connection()
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def init_db():
    with db() as con:
        con.execute("PRAGMA journal_mode=WAL")
        con.executescript("""
            CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL UNIQUE COLLATE NOCASE,
              password_hash TEXT NOT NULL,
              avatar TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS sessions (
              token_hash TEXT PRIMARY KEY,
              user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS scores (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              game TEXT NOT NULL CHECK(game IN ('krillion','plain','factmap','farflung','perceptle','globle','wonderhop')),
              day TEXT NOT NULL,
              score REAL NOT NULL CHECK(score >= 0 AND score <= 10000),
              notes TEXT NOT NULL DEFAULT '',
              breakdown TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(user_id,game,day)
            );
            CREATE INDEX IF NOT EXISTS scores_game_day ON scores(game,day);
            CREATE INDEX IF NOT EXISTS scores_user_day ON scores(user_id,day);
            CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
        """)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Daily Dynasty", version="2.0.0", lifespan=lifespan, docs_url=None, redoc_url=None)
app.mount("/avatars", StaticFiles(directory=str(AVATAR_DIR)), name="avatars")
app.mount("/static", StaticFiles(directory=str(ROOT / "static")), name="static")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    # JSON POSTs and uploads require a custom header. A hostile cross-origin HTML
    # form can't send the header; modern browsers preflight it for other origins.
    if request.url.path.startswith("/api/") and request.method in {"POST", "PATCH", "DELETE", "PUT"}:
        if request.headers.get("x-daily-dynasty") != "1":
            return Response(content='{"detail":"Missing request header"}', status_code=403, media_type="application/json")
        origin = request.headers.get("origin")
        if origin:
            from urllib.parse import urlsplit
            parsed = urlsplit(origin)
            expected = f"{request.url.scheme}://{request.headers.get('host','')}"
            # Trust proxy only if configured in the deployment server.
            if origin.rstrip("/") != expected.rstrip("/") and not (
                os.getenv("DD_PUBLIC_ORIGIN") and origin.rstrip("/") == os.getenv("DD_PUBLIC_ORIGIN").rstrip("/")
            ):
                return Response(content='{"detail":"Invalid origin"}', status_code=403, media_type="application/json")
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Cache-Control"] = "no-store" if request.url.path.startswith("/api/") else "public, max-age=120"
    return response


class AuthInput(BaseModel):
    name: str
    password: str
    invite: str | None = None


class ScoreInput(BaseModel):
    game: str
    day: str
    score: float
    notes: str = ""
    breakdown: dict[str, float] | None = None


class ProfileInput(BaseModel):
    name: str


def public_user(row):
    return {"id": row["id"], "name": row["name"], "avatar": row["avatar"], "created_at": row["created_at"]}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1)
    return salt.hex() + ":" + digest.hex()


def valid_password(password: str, saved: str) -> bool:
    try:
        salt_hex, expected_hex = saved.split(":", 1)
        digest = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1)
        return hmac.compare_digest(digest, bytes.fromhex(expected_hex))
    except (ValueError, TypeError):
        return False


def normalize_name(name: str) -> str:
    name = name.strip()
    if not NAME_RE.fullmatch(name):
        raise HTTPException(status_code=400, detail="Username must be 2–22 characters, starting with a letter or number.")
    return name


def issue_session(response: Response, user_id: int):
    token = secrets.token_urlsafe(36)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    expires = int(time.time()) + SESSION_AGE
    with db() as con:
        con.execute("DELETE FROM sessions WHERE expires_at < ?", (int(time.time()),))
        con.execute("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)", (token_hash, user_id, expires))
    response.set_cookie("dynasty_session", token, max_age=SESSION_AGE, httponly=True, secure=SECURE_COOKIES, samesite="lax", path="/")


def current_user(request: Request):
    token = request.cookies.get("dynasty_session", "")
    if not token:
        return None
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with db() as con:
        user = con.execute("""SELECT u.id,u.name,u.avatar,u.created_at FROM sessions s
                    JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?""",
                    (token_hash, int(time.time()))).fetchone()
    return public_user(user) if user else None


def signed_in(request: Request):
    user = current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    return user

# Lightweight in-process throttle. Production gateways should also rate limit.
FAILED = {}

def throttle(request: Request, username: str):
    key = (request.client.host if request.client else "unknown", username.lower())
    now = time.monotonic()
    recent = [t for t in FAILED.get(key, []) if now-t < 15*60]
    if len(recent) >= 12:
        raise HTTPException(status_code=429, detail="Too many attempts. Try again later.")
    FAILED[key] = recent
    return key


@app.post("/api/register")
def register(data: AuthInput, request: Request, response: Response):
    name = normalize_name(data.name)
    if len(data.password) < 8 or len(data.password) > 128:
        raise HTTPException(status_code=400, detail="Password must be between 8 and 128 characters.")
    if INVITE_CODE and not hmac.compare_digest(data.invite or "", INVITE_CODE):
        raise HTTPException(status_code=403, detail="That invite code is incorrect.")
    throttle(request, name)
    try:
        with db() as con:
            cur = con.execute("INSERT INTO users(name,password_hash) VALUES(?,?)", (name, hash_password(data.password)))
            uid = cur.lastrowid
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="That username is already taken.")
    issue_session(response, uid)
    return {"ok": True}


@app.post("/api/login")
def login(data: AuthInput, request: Request, response: Response):
    key = throttle(request, data.name)
    with db() as con:
        user = con.execute("SELECT id,password_hash FROM users WHERE name=? COLLATE NOCASE", (data.name.strip(),)).fetchone()
    # Match similar execution time when no username exists.
    if not user or not valid_password(data.password, user["password_hash"]):
        FAILED[key].append(time.monotonic())
        raise HTTPException(status_code=401, detail="Incorrect username or password.")
    FAILED.pop(key, None)
    issue_session(response, user["id"])
    return {"ok": True}


@app.post("/api/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get("dynasty_session", "")
    if token:
        with db() as con:
            con.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
    response.delete_cookie("dynasty_session", path="/")
    return {"ok": True}


@app.get("/api/me")
def me(request: Request):
    return {"user": current_user(request)}


@app.get("/api/games")
def games():
    return {"games": GAMES}


@app.get("/api/standings")
def standings(_user=Depends(signed_in)):
    with db() as con:
        users = [public_user(u) for u in con.execute("SELECT id,name,avatar,created_at FROM users ORDER BY id").fetchall()]
        scores = [dict(s) for s in con.execute("SELECT user_id,game,day,score,notes,breakdown FROM scores ORDER BY day DESC,id DESC").fetchall()]
    for s in scores:
        s["breakdown"] = json.loads(s["breakdown"]) if s["breakdown"] else None
    return {"users": users, "scores": scores, "games": GAMES}


@app.patch("/api/profile")
def update_profile(data: ProfileInput, user=Depends(signed_in)):
    name = normalize_name(data.name)
    try:
        with db() as con:
            con.execute("UPDATE users SET name=? WHERE id=?", (name, user["id"]))
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="That username is already taken.")
    return {"ok": True, "name": name}


def validate_score(data: ScoreInput):
    game = GAME_MAP.get(data.game)
    if not game:
        raise HTTPException(status_code=400, detail="Unknown game.")
    try:
        parsed = date.fromisoformat(data.day)
        if parsed.isoformat() != data.day:
            raise ValueError()
    except ValueError:
        raise HTTPException(status_code=400, detail="Enter a valid date.")
    if parsed > datetime.now(EASTERN).date() or parsed < date(2020,1,1):
        raise HTTPException(status_code=400, detail="Future dates and dates before 2020 aren't allowed.")
    value = data.score
    if not isinstance(value, (int,float)) or not float('-inf') < value < float('inf'):
        raise HTTPException(status_code=400, detail="Score must be a finite number.")
    if value < game["min"] or value > game["max"]:
        raise HTTPException(status_code=400, detail=f"{game['name']} score must be between {game['min']} and {game['max']} {game['unit']}.")
    if data.game == "globle" and not float(value).is_integer():
        raise HTTPException(status_code=400, detail="Globle guesses must be whole numbers.")
    if len(data.notes) > 180:
        raise HTTPException(status_code=400, detail="Notes must be under 180 characters.")
    if data.breakdown is not None:
        if data.game != "wonderhop":
            raise HTTPException(status_code=400, detail="Only Wonderhop has mode breakdowns.")
        if set(data.breakdown) != set(WONDERHOP_MODES):
            raise HTTPException(status_code=400, detail="Enter all four Wonderhop modes (Sky, Abyss, Past, Future).")
        for val in data.breakdown.values():
            if not isinstance(val, (float,int)) or not (0 <= val <= 700):
                raise HTTPException(status_code=400, detail="Each Wonderhop mode must be 0–700 points.")
        if abs(sum(data.breakdown.values()) - value) > 0.001:
            raise HTTPException(status_code=400, detail="Wonderhop modes must add up to the total score.")


@app.post("/api/scores")
def save_score(data: ScoreInput, user=Depends(signed_in)):
    validate_score(data)
    with db() as con:
        con.execute("""INSERT INTO scores(user_id,game,day,score,notes,breakdown) VALUES(?,?,?,?,?,?)
            ON CONFLICT(user_id,game,day) DO UPDATE SET score=excluded.score,
              notes=excluded.notes,breakdown=excluded.breakdown,updated_at=CURRENT_TIMESTAMP""",
            (user["id"], data.game, data.day, data.score, data.notes.strip(), json.dumps(data.breakdown) if data.breakdown else None))
    return {"ok": True}


@app.delete("/api/scores/{game}/{day}")
def delete_score(game: str, day: str, user=Depends(signed_in)):
    if game not in GAME_MAP:
        raise HTTPException(status_code=404, detail="Unknown game.")
    with db() as con:
        con.execute("DELETE FROM scores WHERE user_id=? AND game=? AND day=?", (user["id"], game, day))
    return {"ok": True}


@app.post("/api/avatar")
async def upload_avatar(avatar: UploadFile = File(...), user=Depends(signed_in)):
    raw = await avatar.read(2*1024*1024+1)
    if len(raw) > 2*1024*1024:
        raise HTTPException(status_code=413, detail="Image must be under 2MB.")
    try:
        image = Image.open(io.BytesIO(raw))
        image.verify()
        image = Image.open(io.BytesIO(raw))
        image = ImageOps.exif_transpose(image)
        if image.width > 6000 or image.height > 6000 or image.width * image.height > 12_000_000:
            raise ValueError("Image dimensions too large")
        image.thumbnail((512,512))
        image = image.convert("RGB")
        output = io.BytesIO()
        image.save(output, "JPEG", quality=85, optimize=True)
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise HTTPException(status_code=400, detail="Upload a valid JPG, PNG, GIF or WEBP image.")
    filename = uuid.uuid4().hex + ".jpg"
    (AVATAR_DIR / filename).write_bytes(output.getvalue())
    new_url = f"/avatars/{filename}"
    with db() as con:
        old = con.execute("SELECT avatar FROM users WHERE id=?", (user["id"],)).fetchone()
        con.execute("UPDATE users SET avatar=? WHERE id=?", (new_url, user["id"]))
    if old and old["avatar"]:
        old_file = AVATAR_DIR / Path(old["avatar"]).name
        old_file.unlink(missing_ok=True)
    return {"avatar": new_url}


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/{path:path}", include_in_schema=False)
def web_app(path: str):
    # Static asset responses are handled by the mounted static site.
    return FileResponse(ROOT / "static" / "index.html", media_type="text/html")
