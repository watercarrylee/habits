# 安全政策 / Security Policy

## 回報漏洞 / Reporting a vulnerability

請**不要**開公開的 Issue。請使用 GitHub 的私下回報：本專案頁面 → **Security** → **Report a vulnerability**。

Please do **not** open a public issue. Report privately through GitHub: **Security → Report a vulnerability** on this repository.

這是個人專案，會盡力在 7 天內回覆，確認後盡快修正並上版。
This is a personal project; we aim to reply within 7 days and to ship a fix as soon as an issue is confirmed.

## 範圍 / Scope

- 網站本體 / The web app: `index.html`, `sw.js` — https://watercarrylee.github.io/habits/（含 `?demo`、`/preview/`）
- 收盤價排程 / The closing-price job: `.github/workflows/prices.yml`, `tools/fetch_prices.py`, `prices.json`, `prices-30.json`

## 架構說明 / How it works (read before testing)

- 沒有伺服器、沒有帳號。所有使用者資料只存在使用者自己裝置的 `localStorage`，不會上傳。
  No server and no accounts. All user data stays in the user's own browser storage (`localStorage`) and is never uploaded.
- 頁面使用雜湊式 Content-Security-Policy：只允許本頁的 inline script（以 hash 比對）、禁止 inline 事件處理器、禁止連到外部網站，另外程式會偵測自己是否被嵌在其他網頁裡，是的話就停止執行（GitHub Pages 無法送 frame-ancestors 標頭）。
  A hash-based CSP allows only the page's own inline script, blocks inline event handlers and outbound requests, and the page refuses to run inside a frame.
- 備份匯入（貼上或檔案）會經過 `normalize()` 驗證與清理；可選的加密備份使用 Web Crypto。
  Imported backups (pasted or from a file) are validated and cleaned by `normalize()`; optional encrypted backups use Web Crypto.
- 收盤價排程只抓證交所／櫃買中心公開的全市場收盤資料，不含任何人的持股；持股只存在使用者裝置上。
  The price job downloads public, market-wide closing data only. No one's holdings ever leave their device.

## 不在範圍內 / Out of scope

- 需要先取得裝置實體存取、已解鎖手機或已被入侵的瀏覽器的攻擊。
  Attacks that need physical access, an unlocked device, or an already compromised browser.
- 使用者自己貼入或匯入的內容造成的資料變更（除非能造成 XSS 或跳脫 CSP）。
  Data changes caused by content the user pastes or imports themselves — unless it leads to XSS or a CSP bypass.
- GitHub Pages、GitHub Actions 或證交所／櫃買中心網站本身的問題。
  Issues in GitHub Pages, GitHub Actions, or the TWSE / TPEx websites themselves.
- 缺少不影響本專案的 HTTP 標頭（GitHub Pages 無法自訂標頭，相關防護以 `<meta>` CSP 與程式實作）。
  Missing HTTP headers that GitHub Pages cannot set; the equivalent protections are implemented with a `<meta>` CSP and in code.
