export interface Env {
  DB: D1Database;
  ADMIN_PASSWORD: string;
}

const UNIVERSITIES = ["علمی کاربردی", "اصفهان", "آزاد", "غیر انتفاعی"];
const PHONE_REGEX = /^09\d{9}$/;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}

function checkAdmin(request: Request, env: Env): boolean {
  const password = request.headers.get("X-Admin-Password");
  return !!env.ADMIN_PASSWORD && password === env.ADMIN_PASSWORD;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ---------- Public: list available files ----------
      if (path === "/api/files" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT id, file_name, description FROM files WHERE status = 'available' ORDER BY file_name"
        ).all();
        return json(results);
      }

      // ---------- Public: submit ----------
      if (path === "/api/submit" && request.method === "POST") {
        let body: any;
        try { body = await request.json(); } catch { return json({ error: "بدنه درخواست نامعتبر است." }, 400); }

        const full_name = String(body.full_name || "").trim();
        const phone = String(body.phone || "").trim();
        const university = String(body.university || "").trim();
        const file_id = Number(body.file_id);

        if (!full_name || full_name.length < 2) return json({ error: "نام و نام خانوادگی را کامل وارد کنید." }, 400);
        if (!PHONE_REGEX.test(phone)) return json({ error: "شماره تماس باید به فرمت 09XXXXXXXXX باشد." }, 400);
        if (!UNIVERSITIES.includes(university)) return json({ error: "دانشگاه انتخابی نامعتبر است." }, 400);
        if (!file_id || Number.isNaN(file_id)) return json({ error: "فایل انتخابی نامعتبر است." }, 400);

        const update = await env.DB.prepare(
          "UPDATE files SET status = 'taken' WHERE id = ? AND status = 'available'"
        ).bind(file_id).run();

        if (update.meta.changes === 0) {
          return json({ error: "متاسفانه این فایل چند لحظه پیش توسط شخص دیگری انتخاب شد. لطفاً صفحه را رفرش کرده و فایل دیگری انتخاب کنید." }, 409);
        }

        const file = await env.DB.prepare("SELECT file_name, file_url FROM files WHERE id = ?")
          .bind(file_id).first<{ file_name: string; file_url: string }>();

        await env.DB.prepare("INSERT INTO submissions (full_name, phone, university, file_id) VALUES (?, ?, ?, ?)")
          .bind(full_name, phone, university, file_id).run();

        return json({ success: true, file_name: file?.file_name ?? "", file_url: file?.file_url ?? "" });
      }

      // ---------- Admin: list submissions ----------
      if (path === "/api/admin/submissions" && request.method === "GET") {
        if (!checkAdmin(request, env)) return json({ error: "رمز عبور اشتباه است." }, 401);
        const { results } = await env.DB.prepare(
          `SELECT s.id, s.full_name, s.phone, s.university, s.created_at, f.file_name
           FROM submissions s JOIN files f ON f.id = s.file_id
           ORDER BY s.created_at DESC`
        ).all();
        return json(results);
      }

      // ---------- Admin: edit submission ----------
      const editMatch = path.match(/^\/api\/admin\/submission\/(\d+)$/);
      if (editMatch && request.method === "PUT") {
        if (!checkAdmin(request, env)) return json({ error: "رمز عبور اشتباه است." }, 401);
        const id = Number(editMatch[1]);
        let body: any;
        try { body = await request.json(); } catch { return json({ error: "بدنه نامعتبر است." }, 400); }

        const full_name = String(body.full_name || "").trim();
        const phone = String(body.phone || "").trim();
        const university = String(body.university || "").trim();
        const new_file_id = Number(body.file_id);

        if (!full_name || full_name.length < 2) return json({ error: "نام را کامل وارد کنید." }, 400);
        if (!PHONE_REGEX.test(phone)) return json({ error: "شماره تماس نامعتبر است." }, 400);
        if (!UNIVERSITIES.includes(university)) return json({ error: "دانشگاه نامعتبر است." }, 400);
        if (!new_file_id) return json({ error: "فایل انتخابی نامعتبر است." }, 400);

        // get old file_id
        const old = await env.DB.prepare("SELECT file_id FROM submissions WHERE id = ?")
          .bind(id).first<{ file_id: number }>();
        if (!old) return json({ error: "ثبت‌نام یافت نشد." }, 404);

        // if file changed: free old, take new (atomically)
        if (old.file_id !== new_file_id) {
          const upd = await env.DB.prepare(
            "UPDATE files SET status = 'taken' WHERE id = ? AND status = 'available'"
          ).bind(new_file_id).run();
          if (upd.meta.changes === 0) return json({ error: "فایل انتخابی توسط شخص دیگری گرفته شده است." }, 409);
          await env.DB.prepare("UPDATE files SET status = 'available' WHERE id = ?").bind(old.file_id).run();
        }

        await env.DB.prepare(
          "UPDATE submissions SET full_name=?, phone=?, university=?, file_id=? WHERE id=?"
        ).bind(full_name, phone, university, new_file_id, id).run();

        return json({ success: true });
      }

      // ---------- Admin: delete submission ----------
      if (editMatch && request.method === "DELETE") {
        if (!checkAdmin(request, env)) return json({ error: "رمز عبور اشتباه است." }, 401);
        const id = Number(editMatch[1]);
        const sub = await env.DB.prepare("SELECT file_id FROM submissions WHERE id = ?")
          .bind(id).first<{ file_id: number }>();
        if (!sub) return json({ error: "ثبت‌نام یافت نشد." }, 404);
        await env.DB.prepare("DELETE FROM submissions WHERE id = ?").bind(id).run();
        await env.DB.prepare("UPDATE files SET status = 'available' WHERE id = ?").bind(sub.file_id).run();
        return json({ success: true });
      }

      // ---------- Admin: list all files ----------
      if (path === "/api/admin/files" && request.method === "GET") {
        if (!checkAdmin(request, env)) return json({ error: "رمز عبور اشتباه است." }, 401);
        const { results } = await env.DB.prepare(
          "SELECT id, file_name, status FROM files ORDER BY file_name"
        ).all();
        return json(results);
      }

      // ---------- Admin: add new file ----------
      if (path === "/api/admin/file" && request.method === "POST") {
        if (!checkAdmin(request, env)) return json({ error: "رمز عبور اشتباه است." }, 401);
        let body: any;
        try { body = await request.json(); } catch { return json({ error: "بدنه نامعتبر است." }, 400); }
        const file_name = String(body.file_name || "").trim();
        const file_url = String(body.file_url || "").trim();
        if (!file_name || !file_url) return json({ error: "نام و لینک فایل الزامی است." }, 400);
        await env.DB.prepare("INSERT INTO files (file_name, file_url) VALUES (?, ?)")
          .bind(file_name, file_url).run();
        return json({ success: true });
      }

      // ---------- Admin: release file ----------
      const releaseMatch = path.match(/^\/api\/admin\/release\/(\d+)$/);
      if (releaseMatch && request.method === "POST") {
        if (!checkAdmin(request, env)) return json({ error: "رمز عبور اشتباه است." }, 401);
        const id = Number(releaseMatch[1]);
        await env.DB.prepare("UPDATE files SET status = 'available' WHERE id = ?").bind(id).run();
        return json({ success: true });
      }

      // ---------- Admin: CSV export ----------
      if (path === "/api/admin/export" && request.method === "GET") {
        const password = url.searchParams.get("password");
        if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) return json({ error: "رمز عبور اشتباه است." }, 401);
        const { results } = await env.DB.prepare(
          `SELECT s.full_name, s.phone, s.university, f.file_name, s.created_at
           FROM submissions s JOIN files f ON f.id = s.file_id ORDER BY s.created_at DESC`
        ).all();
        const header = "نام و نام خانوادگی,شماره تماس,دانشگاه,فایل,تاریخ ثبت\n";
        const rows = (results as any[]).map(r =>
          `"${(r.full_name ?? "").replace(/"/g, '""')}","${r.phone}","${r.university}","${r.file_name}","${r.created_at}"`
        ).join("\n");
        return new Response("\uFEFF" + header + rows, {
          headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=submissions.csv" },
        });
      }

      return json({ error: "یافت نشد." }, 404);
    } catch (err: any) {
      return json({ error: "خطای سرور: " + (err?.message || String(err)) }, 500);
    }
  },
};
