/**
 * GAS Web App API クライアント
 * デプロイ URL を変更する場合はここを書き換え
 */
const GAS_URL = "https://script.google.com/macros/s/AKfycbzd3l1jExbVQBM6g-Dyodz0q2pLwSwNlnft3P3CwpFchW75p7RZOVIaHzPkuXTF54ZV/exec";

async function gasGet(action, params = {}) {
  const url = new URL(GAS_URL);
  url.searchParams.set("action", action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function gasPost(data) {
  const res = await fetch(GAS_URL, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

export { gasGet, gasPost, GAS_URL };
