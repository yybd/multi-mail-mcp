*[English](README.md) · עברית*

# multi-mail MCP

שרת MCP לכמה תיבות Gmail במקביל — חיפוש, קריאה, טיוטות ושליחה — עבור **Claude Desktop**, **Claude Code** ו-**ChatGPT**.

- **stdio** (`dist/server.js`) — ל-Claude Desktop ול-Claude Code, רץ מקומית.
- **Streamable HTTP** (`dist/http.js`) — ל-ChatGPT (ולכל לקוח שמתחבר ב-URL), מוגן בטוקן.

## כלים

| כלי | מה עושה |
|---|---|
| `list_accounts` | החשבונות המחוברים והכינויים שלהם |
| `search_emails` | חיפוש בתחביר Gmail בתיבה אחת, או בכולן עם `account="all"` |
| `read_email` | הודעה מלאה: כותרות, גוף כטקסט (HTML מומר), שמות קבצים מצורפים |
| `read_thread` | שרשור שלם |
| `list_labels` | תוויות/תיקיות של תיבה |
| `create_draft` | טיוטה (חדשה או תשובה) — לא נשלחת |
| `send_email` | שליחה מיידית (חדשה או תשובה) |
| `list_drafts` / `send_draft` | טיוטות ממתינות / שליחת טיוטה |
| `search` / `fetch` | הצורה ש-ChatGPT מצפה לה (connectors, deep research) — מחפש בכל התיבות |

בכל כלי הפרמטר `account` מקבל כתובת מלאה, כינוי (`work`), או את החלק שלפני ה-@. כשיש רק חשבון אחד אפשר להשמיט אותו; `MULTI_MAIL_DEFAULT` קובע ברירת מחדל.
תשובה (`reply_to_message_id`) נכנסת לשרשור הנכון וממלאת לבד נמען ונושא; `reply_all` מוסיף את כל הנמענים המקוריים.

**הרשאות:** `gmail.readonly` + `gmail.compose` בלבד. השרת **לא יכול למחוק** מייל, להעביר לאשפה או לשנות הגדרות.

## למה עוד שרת — השוואה לקיים

נבדק ב-2026-11-07. מספרי הכוכבים מאותו יום. את הנתונים על החיבורים המובנים של Claude ו-ChatGPT לא מצאתי בתיעוד רשמי, הם מבוססים בעיקר על בלוגים של ספקים מתחרים, ולכן כדאי לבדוק אותם מחדש.

| אפשרות | כמה תיבות | שליחה | Claude Desktop / Code | ChatGPT | איפה עובר המייל |
|---|---|---|---|---|---|
| **multi-mail (הפרויקט הזה)** | כן, כולל חיפוש בכולן (`all`) | כן, וגם טיוטות ותשובה בשרשור | כן (stdio) | כן (HTTP + טוקן) | רק אצלך ובגוגל |
| החיבור המובנה של Claude ל-Gmail | לא, חשבון אחד | לא, טיוטות בלבד | Claude בלבד | — | Anthropic |
| החיבור המובנה של ChatGPT ל-Gmail | המקורות סותרים | כן, מיוני 2026, באתר ובאישור | — | כן | OpenAI |
| [השרת הרשמי של גוגל](https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server) (Developer Preview) | לא מתועד | **אין כלי שליחה** | Claude | לא רשום | גוגל |
| [google_workspace_mcp](https://github.com/taylorwilsdon/google_workspace_mcp) (~3.5k ⭐) | ריבוי *משתמשים*. כמה תיבות של אדם אחד באותו סשן לא מתועד | כן | כן | כן (Developer Mode) | רק אצלך ובגוגל |
| [navbuildz/gmail-mcp-server](https://github.com/navbuildz/gmail-mcp-server) (16 ⭐) | כן, כולל `all` | כן | דרך URL | כנראה. לא נבדק | אצלך, ונדרש Redis |
| [dmorrill/gmail-mcp-multi](https://github.com/dmorrill/gmail-mcp-multi), [jwlutz/gmail_connector](https://github.com/jwlutz/gmail_connector), [3vening/gmail-mcp](https://github.com/3vening/gmail-mcp) ועוד | כן | כן, בחלקם רק אחרי הפעלה מפורשת | כן (stdio) | **לא**, מקומי בלבד | רק אצלך ובגוגל |
| Composio / Zapier MCP / Pipedream | Composio: כן | כן | כן (URL) | כן (URL) | **דרך הספק**, בתשלום |

**המסקנה:**
- החיבורים המובנים לא מכסים כמה תיבות ושליחה בכל הלקוחות.
- רוב השרתים הקיימים שתומכים בכמה תיבות רצים מקומית בלבד, ולכן ChatGPT לא יכול להתחבר אליהם.
- השירותים המתווכים מעבירים את הדואר ואת הטוקנים דרך צד שלישי.
- multi-mail משלב את כל אלה ונשאר צר:
  - בלי הרשאת מחיקה.
  - הטוקנים נשמרים מקומית בהרשאות `600`.
  - שרת ה-HTTP לא עולה בלי טוקן.
- **אם צריך גם Drive, Calendar או Docs**, `google_workspace_mcp` הוא החלופה הבוגרת.

## התקנה

צריך Node.js 20 ומעלה. אין מה להתקין: כל הפקודות במדריך מריצות את החבילה שפורסמה דרך `npx`.

<details>
<summary>הרצה מקוד המקור</summary>

```bash
git clone https://github.com/yybd/multi-mail-mcp.git multi-mail && cd multi-mail && npm install && npm run build
```

ואז בכל מקום שכתוב בו `npx -y @yybd/multi-mail-mcp`, משתמשים ב-`node dist/main.js`.
</details>

כל משתמש יוצר OAuth client משלו בחשבון הגוגל שלו (שלב 1). כך אין צורך באימות של גוגל, והטוקנים לא עוברים דרך אף צד שלישי.

### 1. יצירת OAuth client ב-Google Cloud (פעם אחת)

את השלבים האלה עושים פעם אחת, מחשבון גוגל אחד. אותו client משמש אחר כך לכל התיבות.

1. **פרויקט:** להיכנס ל-[console.cloud.google.com/projectcreate](https://console.cloud.google.com/projectcreate), לתת שם (למשל `multi-mail`) וללחוץ **Create**. לוודא שהפרויקט נבחר בתפריט העליון.
2. **Gmail API:** בדף ה-[Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com) ללחוץ **Enable**.
3. **מסך ההסכמה:** ב-[Google Auth Platform](https://console.cloud.google.com/auth/overview) ללחוץ **Get started**, ואז:
   - App name: `multi-mail`.
   - User support email: הכתובת שלך.
   - Audience: **External**.
   - Contact information: הכתובת שלך.
   - לאשר וללחוץ **Create**.

   את ה-scopes לא צריך להגדיר כאן, השרת מבקש אותם בעצמו.
4. **פרסום:** ב-**Audience** ללחוץ **Publish app** ואז **Confirm**. הסטטוס צריך להיות *In production*.
   - ⚠️ במצב *Testing* הגישה פגה **כל 7 ימים**.
   - לשימוש אישי אין צורך באימות של גוגל.
   - אם בכל זאת נשארים ב-*Testing*, צריך להוסיף כל כתובת Gmail תחת *Test users*.
5. **Client:** ב-**Clients** ללחוץ **Create client**, לבחור את הסוג **Desktop app**, לתת שם וללחוץ **Create**. מיד אחר כך ללחוץ **Download JSON**, כי ה-secret מוצג במלואו רק בחלון הזה. לשמור את הקובץ כך:

```bash
mkdir -p ~/.multi-mail && mv ~/Downloads/client_secret_*.json ~/.multi-mail/credentials.json
```

### 2. חיבור התיבות

```bash
npx -y @yybd/multi-mail-mcp add --alias work
```

```bash
npx -y @yybd/multi-mail-mcp add --alias home
```

כל `add` פותח דפדפן לבחירת חשבון גוגל ולאישור. חוזרים על זה לכל תיבה.
- תופיע אזהרת **"Google hasn't verified this app"**. זה צפוי, כי זו האפליקציה שלך. ממשיכים ב-**Advanced** ואז **Go to multi-mail (unsafe)**.
- במסך ההרשאות מסמנים את **כל** התיבות. אם אחת חסרה, ה-CLI יעצור ויגיד איזו.

ניהול: `npx -y @yybd/multi-mail-mcp list` · `check` (בודק שכל החשבונות עדיין מורשים) · `alias <account> <name>` · `remove <account>`.

שינוי כינוי: החשבון יכול להיות הכינוי הנוכחי, הכתובת, או החלק שלפני ה-@. לדוגמה, הפקודה הזו משנה את `tech` ל-`work`, והשינוי תקף מיד, בלי הפעלה מחדש:

```bash
npx -y @yybd/multi-mail-mcp alias tech work
```
טוקנים נשמרים ב-`~/.multi-mail/accounts/` בהרשאות `600` (שנה מיקום עם `MULTI_MAIL_HOME`). שרת שרץ קולט חשבון חדש בלי הפעלה מחדש.

## חיבור ללקוחות

### Claude Code

```bash
claude mcp add multi-mail -s user -- npx -y @yybd/multi-mail-mcp
```

### Claude Desktop

ב-`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "multi-mail": {
      "command": "npx",
      "args": ["-y", "@yybd/multi-mail-mcp"]
    }
  }
}
```

אחר כך צריך להפעיל מחדש את Claude Desktop. אם הוא לא מוצא את `npx`, שים את הנתיב המלא שלו (`which npx`, למשל `/opt/homebrew/bin/npx`).

### ChatGPT

ChatGPT מתחבר רק לשרת מרוחק ב-HTTPS, לכן מריצים את מצב ה-HTTP ופותחים אליו מנהרה.

```bash
npx -y @yybd/multi-mail-mcp token
```

```bash
MCP_AUTH_TOKEN=<הטוקן> npx -y @yybd/multi-mail-mcp http
```

```bash
cloudflared tunnel --url http://127.0.0.1:3333
```

(או `ngrok http 3333`.) ב-ChatGPT: **Settings → Apps & Connectors → Advanced → Developer mode** → **Create** →
- URL: `https://<הכתובת-מהמנהרה>/mcp?api_key=<הטוקן>`
- Authentication: **No authentication** (הטוקן כבר ב-URL).

השרת מאזין רק ל-`127.0.0.1` ולא יעלה בלי `MCP_AUTH_TOKEN` של 24 תווים לפחות. לקוחות שיודעים לשלוח כותרות יכולים להשתמש ב-`Authorization: Bearer <token>` במקום ב-`api_key`.
⚠️ מי שיש לו את ה-URL המלא יכול לקרוא ולשלוח מהתיבות שלך — שמור עליו כמו על סיסמה, והחלף טוקן (פקודת `token`) אם דלף.

משתני סביבה ל-HTTP: `PORT` (ברירת מחדל 3333), `HOST` (ברירת מחדל `127.0.0.1`), `MCP_AUTH_TOKEN`.

## פיתוח

```bash
npm test
```

בדיקות לא מקוונות (בלי חשבון גוגל): קידוד MIME בעברית, בחירת חשבון, רשימת הכלים ב-stdio וב-HTTP, ואכיפת הטוקן.

מבנה: `src/config.ts` (חשבונות וקבצים) · `src/gmail.ts` (קריאות ל-Gmail) · `src/mime.ts` (בניית/פענוח הודעות) · `src/mcp.ts` (הכלים) · `src/server.ts` / `src/http.ts` (תעבורה) · `src/cli.ts` (ניהול חשבונות).

**לא נתמך עדיין:** הורדה/צירוף קבצים, שינוי תוויות, סימון כנקרא.

## רישיון

MIT — ראה [LICENSE](LICENSE).
