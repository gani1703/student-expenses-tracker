from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
import sqlite3
import os
from datetime import datetime, date, timedelta
import calendar

app = Flask(__name__)
CORS(app)

# Use absolute path so DB works on Render and locally
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "expense_tracker.db")

# ─────────────────────────────────────────────
#  Database helpers
# ─────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE TABLE IF NOT EXISTS categories (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                name      TEXT    NOT NULL UNIQUE,
                icon      TEXT    DEFAULT '💰',
                color     TEXT    DEFAULT '#a8d8ea',
                is_custom INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS expenses (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                amount      REAL    NOT NULL,
                description TEXT,
                category_id INTEGER,
                expense_date TEXT   NOT NULL,
                notes       TEXT,
                is_subscription INTEGER DEFAULT 0,
                recurrence  TEXT,
                created_at  TEXT    DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS daily_notes (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                note_date  TEXT    NOT NULL UNIQUE,
                content    TEXT
            );
        """)

        # Seed default categories
        defaults = [
            ("Food & Canteen",            "🍔", "#ffd6a5", 0),
            ("Transport",                 "🚌", "#caffbf", 0),
            ("Stationery & Academics",    "📚", "#a0c4ff", 0),
            ("Subscriptions & Entertainment", "🎬", "#bdb2ff", 0),
            ("Social Outings",            "🎉", "#ffc6ff", 0),
        ]
        for name, icon, color, is_custom in defaults:
            conn.execute(
                "INSERT OR IGNORE INTO categories (name, icon, color, is_custom) VALUES (?, ?, ?, ?)",
                (name, icon, color, is_custom)
            )
        conn.commit()


# ─────────────────────────────────────────────
#  Pages
# ─────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


# ─────────────────────────────────────────────
#  Settings API
# ─────────────────────────────────────────────

@app.route("/api/settings", methods=["GET"])
def get_settings():
    with get_db() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    return jsonify({r["key"]: r["value"] for r in rows})


@app.route("/api/settings", methods=["POST"])
def save_settings():
    data = request.json
    with get_db() as conn:
        for key, value in data.items():
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, str(value))
            )
        conn.commit()
    return jsonify({"status": "ok"})


# ─────────────────────────────────────────────
#  Categories API
# ─────────────────────────────────────────────

@app.route("/api/categories", methods=["GET"])
def get_categories():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM categories ORDER BY is_custom, id").fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/categories", methods=["POST"])
def add_category():
    data = request.json
    name  = data.get("name", "").strip()
    icon  = data.get("icon", "💰")
    color = data.get("color", "#a8d8ea")
    if not name:
        return jsonify({"error": "Name required"}), 400
    with get_db() as conn:
        try:
            conn.execute(
                "INSERT INTO categories (name, icon, color, is_custom) VALUES (?, ?, ?, 1)",
                (name, icon, color)
            )
            conn.commit()
            row = conn.execute("SELECT * FROM categories WHERE name=?", (name,)).fetchone()
            return jsonify(dict(row)), 201
        except sqlite3.IntegrityError:
            return jsonify({"error": "Category already exists"}), 409


@app.route("/api/categories/<int:cat_id>", methods=["PUT"])
def update_category(cat_id):
    data = request.json
    with get_db() as conn:
        conn.execute(
            "UPDATE categories SET name=?, icon=?, color=? WHERE id=?",
            (data.get("name"), data.get("icon"), data.get("color"), cat_id)
        )
        conn.commit()
    return jsonify({"status": "ok"})


@app.route("/api/categories/<int:cat_id>", methods=["DELETE"])
def delete_category(cat_id):
    with get_db() as conn:
        conn.execute("DELETE FROM categories WHERE id=? AND is_custom=1", (cat_id,))
        conn.commit()
    return jsonify({"status": "ok"})


# ─────────────────────────────────────────────
#  Expenses API
# ─────────────────────────────────────────────

@app.route("/api/expenses", methods=["GET"])
def get_expenses():
    view        = request.args.get("view", "monthly")
    filter_date = request.args.get("date", date.today().isoformat())

    try:
        d = datetime.strptime(filter_date, "%Y-%m-%d").date()
    except ValueError:
        d = date.today()

    if view == "daily":
        start, end = d.isoformat(), d.isoformat()
    elif view == "weekly":
        start_dt = d - timedelta(days=d.weekday())
        start = start_dt.isoformat()
        end   = (start_dt + timedelta(days=6)).isoformat()
    else:  # monthly
        start = d.replace(day=1).isoformat()
        last  = calendar.monthrange(d.year, d.month)[1]
        end   = d.replace(day=last).isoformat()

    with get_db() as conn:
        rows = conn.execute("""
            SELECT e.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
            FROM expenses e
            LEFT JOIN categories c ON e.category_id = c.id
            WHERE e.expense_date BETWEEN ? AND ?
            ORDER BY e.expense_date DESC, e.created_at DESC
        """, (start, end)).fetchall()

    return jsonify([dict(r) for r in rows])


@app.route("/api/expenses/date/<string:expense_date>", methods=["GET"])
def get_expenses_by_date(expense_date):
    with get_db() as conn:
        rows = conn.execute("""
            SELECT e.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
            FROM expenses e
            LEFT JOIN categories c ON e.category_id = c.id
            WHERE e.expense_date = ?
            ORDER BY e.created_at DESC
        """, (expense_date,)).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/expenses", methods=["POST"])
def add_expense():
    data = request.json
    required = ("amount", "expense_date")
    for f in required:
        if not data.get(f):
            return jsonify({"error": f"{f} is required"}), 400
    with get_db() as conn:
        cur = conn.execute("""
            INSERT INTO expenses (amount, description, category_id, expense_date, notes, is_subscription, recurrence)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            float(data["amount"]),
            data.get("description", ""),
            data.get("category_id"),
            data["expense_date"],
            data.get("notes", ""),
            int(data.get("is_subscription", 0)),
            data.get("recurrence", "")
        ))
        conn.commit()
        new_id = cur.lastrowid
        row = conn.execute("""
            SELECT e.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
            FROM expenses e
            LEFT JOIN categories c ON e.category_id = c.id
            WHERE e.id = ?
        """, (new_id,)).fetchone()
    return jsonify(dict(row)), 201


@app.route("/api/expenses/<int:exp_id>", methods=["PUT"])
def update_expense(exp_id):
    data = request.json
    with get_db() as conn:
        conn.execute("""
            UPDATE expenses
            SET amount=?, description=?, category_id=?, expense_date=?, notes=?, is_subscription=?, recurrence=?
            WHERE id=?
        """, (
            float(data["amount"]),
            data.get("description", ""),
            data.get("category_id"),
            data["expense_date"],
            data.get("notes", ""),
            int(data.get("is_subscription", 0)),
            data.get("recurrence", ""),
            exp_id
        ))
        conn.commit()
        row = conn.execute("""
            SELECT e.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
            FROM expenses e LEFT JOIN categories c ON e.category_id = c.id
            WHERE e.id = ?
        """, (exp_id,)).fetchone()
    return jsonify(dict(row))


@app.route("/api/expenses/<int:exp_id>", methods=["DELETE"])
def delete_expense(exp_id):
    with get_db() as conn:
        conn.execute("DELETE FROM expenses WHERE id=?", (exp_id,))
        conn.commit()
    return jsonify({"status": "ok"})


# ─────────────────────────────────────────────
#  Analytics API
# ─────────────────────────────────────────────

@app.route("/api/analytics/monthly", methods=["GET"])
def monthly_analytics():
    year  = int(request.args.get("year",  date.today().year))
    month = int(request.args.get("month", date.today().month))
    start = date(year, month, 1).isoformat()
    last  = calendar.monthrange(year, month)[1]
    end   = date(year, month, last).isoformat()

    with get_db() as conn:
        # Category breakdown
        cat_rows = conn.execute("""
            SELECT c.name, c.icon, c.color, SUM(e.amount) AS total
            FROM expenses e
            LEFT JOIN categories c ON e.category_id = c.id
            WHERE e.expense_date BETWEEN ? AND ?
            GROUP BY e.category_id
            ORDER BY total DESC
        """, (start, end)).fetchall()

        # Weekly trend (4 weeks)
        weekly = []
        cur_start = date(year, month, 1)
        while cur_start <= date(year, month, last):
            cur_end = min(cur_start + timedelta(days=6), date(year, month, last))
            row = conn.execute("""
                SELECT COALESCE(SUM(amount), 0) AS total
                FROM expenses
                WHERE expense_date BETWEEN ? AND ?
            """, (cur_start.isoformat(), cur_end.isoformat())).fetchone()
            weekly.append({
                "label": f"{cur_start.strftime('%b %d')} – {cur_end.strftime('%b %d')}",
                "total": row["total"]
            })
            cur_start = cur_end + timedelta(days=1)

        # Daily totals for calendar
        daily_rows = conn.execute("""
            SELECT expense_date, SUM(amount) AS total
            FROM expenses
            WHERE expense_date BETWEEN ? AND ?
            GROUP BY expense_date
        """, (start, end)).fetchall()

    return jsonify({
        "categories": [dict(r) for r in cat_rows],
        "weekly":     weekly,
        "daily":      {r["expense_date"]: r["total"] for r in daily_rows}
    })


@app.route("/api/analytics/insights", methods=["GET"])
def insights():
    today = date.today()
    month_start = today.replace(day=1).isoformat()
    month_end   = today.isoformat()
    week_start  = (today - timedelta(days=today.weekday())).isoformat()

    with get_db() as conn:
        settings_rows = conn.execute("SELECT key, value FROM settings").fetchall()
        settings = {r["key"]: r["value"] for r in settings_rows}
        budget = float(settings.get("monthly_budget", 0))

        month_total_row = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) AS t FROM expenses WHERE expense_date BETWEEN ? AND ?",
            (month_start, month_end)
        ).fetchone()
        month_total = month_total_row["t"]

        cat_rows = conn.execute("""
            SELECT c.name, SUM(e.amount) AS total
            FROM expenses e LEFT JOIN categories c ON e.category_id = c.id
            WHERE e.expense_date BETWEEN ? AND ?
            GROUP BY e.category_id ORDER BY total DESC
        """, (month_start, month_end)).fetchall()

        sub_total_row = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) AS t FROM expenses WHERE is_subscription=1 AND expense_date BETWEEN ? AND ?",
            (month_start, month_end)
        ).fetchone()
        sub_total = sub_total_row["t"]

    tips = []
    days_elapsed = today.day
    days_in_month = calendar.monthrange(today.year, today.month)[1]

    # Budget usage
    if budget > 0:
        pct = (month_total / budget) * 100
        if pct >= 90:
            tips.append({"level": "danger",  "text": f"⚠️ You've used {pct:.0f}% of your monthly budget. Slow down!"})
        elif pct >= 70:
            tips.append({"level": "warning", "text": f"📊 {pct:.0f}% of budget used with {days_in_month - days_elapsed} days left."})
        elif pct < 30 and days_elapsed > 15:
            tips.append({"level": "success", "text": "🌟 Great job! You're spending well below budget."})

    # Category tips
    if cat_rows and month_total > 0:
        top = cat_rows[0]
        top_pct = (top["total"] / month_total) * 100
        if top_pct > 40:
            tips.append({"level": "warning", "text": f"🍔 You spent {top_pct:.0f}% on '{top['name']}'. Consider trimming this category."})

    # Subscription tip
    if sub_total > 0 and month_total > 0:
        sub_pct = (sub_total / month_total) * 100
        if sub_pct > 20:
            tips.append({"level": "warning", "text": f"📱 Subscriptions account for {sub_pct:.0f}% of spending this month."})

    # Daily avg tip
    if days_elapsed > 0:
        daily_avg = month_total / days_elapsed
        projected = daily_avg * days_in_month
        if budget > 0 and projected > budget * 1.1:
            tips.append({"level": "danger", "text": f"📈 At your current pace, you'll exceed budget by ₹{projected - budget:.0f}."})

    if not tips:
        tips.append({"level": "success", "text": "✅ Your spending looks healthy this month. Keep it up!"})

    # Days until broke
    remaining = max(budget - month_total, 0) if budget > 0 else 0
    days_left  = days_in_month - days_elapsed
    if days_elapsed > 0 and month_total > 0:
        daily_avg = month_total / days_elapsed
        days_until_broke = int(remaining / daily_avg) if daily_avg > 0 else days_left
    else:
        days_until_broke = days_left

    return jsonify({
        "tips": tips,
        "days_until_broke": days_until_broke,
        "daily_avg": round(month_total / max(days_elapsed, 1), 2),
        "month_total": month_total,
        "budget": budget,
        "remaining": remaining
    })


# ─────────────────────────────────────────────
#  Daily Notes API
# ─────────────────────────────────────────────

@app.route("/api/notes/<string:note_date>", methods=["GET"])
def get_note(note_date):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM daily_notes WHERE note_date=?", (note_date,)).fetchone()
    return jsonify(dict(row) if row else {"note_date": note_date, "content": ""})


@app.route("/api/notes/<string:note_date>", methods=["POST"])
def save_note(note_date):
    content = request.json.get("content", "")
    with get_db() as conn:
        conn.execute(
            "INSERT INTO daily_notes (note_date, content) VALUES (?, ?) ON CONFLICT(note_date) DO UPDATE SET content=excluded.content",
            (note_date, content)
        )
        conn.commit()
    return jsonify({"status": "ok"})


# ─────────────────────────────────────────────
#  Subscriptions summary
# ─────────────────────────────────────────────

@app.route("/api/subscriptions", methods=["GET"])
def get_subscriptions():
    with get_db() as conn:
        rows = conn.execute("""
            SELECT e.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
            FROM expenses e
            LEFT JOIN categories c ON e.category_id = c.id
            WHERE e.is_subscription = 1
            ORDER BY e.expense_date DESC
        """).fetchall()
    return jsonify([dict(r) for r in rows])


# ─────────────────────────────────────────────
# Initialize DB on startup (works with both gunicorn and direct python run)
init_db()

if __name__ == "__main__":
    app.run(debug=True, port=5000)
