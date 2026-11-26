"""USB-only TodayTodo desktop inbox. Acknowledgment means durable queue storage."""
import argparse
import base64
import binascii
import json
import re
import secrets
import socket
import sqlite3
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

PORT = 38471
MAX_REQUEST = 750000
TEST_RECIPIENTS = {"qq": "我的手机", "wechat": "文件传输助手"}


def validate(job, now):
    if not isinstance(job, dict) or set(job) != {"id", "plan", "dueAt"}:
        raise ValueError("invalid job")
    key, plan, due = job["id"], job["plan"], job["dueAt"]
    if not isinstance(key, str) or not re.fullmatch("[0-9a-f]{32}", key):
        raise ValueError("invalid id")
    if type(due) is not int or not now < due <= now + 366 * 86400000:
        raise ValueError("invalid scheduled time")
    if not isinstance(plan, dict) or set(plan) != {"platform", "recipient", "text", "audio"}:
        raise ValueError("invalid plan")
    if not all(isinstance(value, str) for value in plan.values()):
        raise ValueError("invalid fields")
    if TEST_RECIPIENTS.get(plan["platform"]) != plan["recipient"]:
        raise ValueError("invalid test recipient")
    text, audio = plan["text"], plan["audio"]
    if len(text) > 4000 or not (text.strip() or audio):
        raise ValueError("invalid body")
    if audio:
        prefix = "data:audio/wav;base64,"
        if not audio.startswith(prefix):
            raise ValueError("only WAV supported")
        try:
            wav = base64.b64decode(audio[len(prefix):], validate=True)
        except binascii.Error as exc:
            raise ValueError("invalid WAV encoding") from exc
        if not 44 <= len(wav) <= 512 * 1024 or wav[:4] != b"RIFF" or wav[8:12] != b"WAVE":
            raise ValueError("invalid WAV")


class Inbox:
    def __init__(self, filename):
        self.db = sqlite3.connect(filename)
        with self.db:
            self.db.execute(
                "CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, due_at INTEGER, payload TEXT)"
            )

    def accept(self, payload):
        if not isinstance(payload, dict) or not isinstance(payload.get("id"), str):
            return 400
        canonical = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        with self.db:
            old = self.db.execute("SELECT payload FROM jobs WHERE id = ?", (payload["id"],)).fetchone()
            if old:
                return 200 if old[0] == canonical else 409
            try:
                validate(payload, time.time_ns() // 1000000)
            except ValueError:
                return 400
            self.db.execute("INSERT INTO jobs VALUES (?, ?, ?)", (payload["id"], payload["dueAt"], canonical))
        return 201


class RelayHandler(BaseHTTPRequestHandler):
    def setup(self):
        self.request.settimeout(4)
        super().setup()

    def log_message(self, *_):
        pass

    def do_POST(self):
        if self.path != "/jobs":
            self.send_error(404)
            return
        auth = self.headers.get("Authorization", "").encode("utf-8")
        if not secrets.compare_digest(auth, self.server.authorization):
            self.send_error(401)
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_REQUEST:
                self.send_error(413)
                return
            body = self.rfile.read(size)
            status = self.server.inbox.accept(json.loads(body))
        except (ValueError, TimeoutError):
            status = 400
        self.send_response(status)
        self.send_header("Content-Length", "0")
        self.end_headers()


class RelayServer(HTTPServer):
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("database", type=Path)
    parser.add_argument("--status", action="store_true", help="show due and future counts without reading message contents")
    parser.add_argument("--pairing-file", type=Path, help="write the ephemeral test pairing code to a local file")
    args = parser.parse_args()
    inbox = Inbox(args.database)
    if args.status:
        due, future = inbox.db.execute(
            "SELECT count(CASE WHEN due_at <= ? THEN 1 END), count(CASE WHEN due_at > ? THEN 1 END) FROM jobs",
            (now := time.time_ns() // 1000000, now),
        ).fetchone()
        status = {"due": due, "future": future}
        if inbox.db.execute("SELECT 1 FROM sqlite_master WHERE name = 'relay_parts'").fetchone():
            status["parts"] = dict(inbox.db.execute(
                "SELECT status, count(*) FROM relay_parts GROUP BY status"
            ).fetchall())
        print(json.dumps(status))
        return
    code = secrets.token_hex(16)
    with RelayServer(("127.0.0.1", PORT), RelayHandler) as server:
        server.inbox = inbox
        server.authorization = ("Bearer " + code).encode("ascii")
        if args.pairing_file:
            with args.pairing_file.open("x", encoding="ascii") as pairing_file:
                pairing_file.write(code)
        else:
            print("电脑配对码 " + code, flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
