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
| `get_attachment` | מוריד קובץ מצורף אחד: טקסט ו-PDF חוזרים כטקסט, ותמונות כתמונה. כל השאר, וגם PDF סרוק, נשמרים ב-`~/.multi-mail/attachments` |
| `modify_labels` | מוסיף או מסיר תוויות להודעות או לשרשור: סימון כנקרא או כלא נקרא, ארכוב, כוכב, שיוך לתווית. רק בחשבונות שחוברו עם `--labels` |
| `create_label` | יוצר תווית (`Projects/Acme` יוצר קינון). רק בחשבונות שחוברו עם `--labels` |
| `list_events` | אירועי יומן בין שני זמנים, בכל היומנים שמוצגים ב-Google Calendar, לחשבון אחד או לכולם. רק בחשבונות שחוברו עם `--calendar` |
| `find_free_time` | חלונות פנויים באורך מבוקש בשעות העבודה, בבדיקה מול כל היומנים של כל החשבונות שהיומן מופעל בהם |
| `create_event` | יוצר אירוע ביומן שלך בלבד. אף אחד לא מוזמן ולא נשלח שום מייל |
| `search` / `fetch` | הצורה ש-ChatGPT מצפה לה (connectors, deep research) — מחפש בכל התיבות |

בכל כלי הפרמטר `account` מקבל כתובת מלאה, כינוי (`work`), או את החלק שלפני ה-@. כשיש רק חשבון אחד אפשר להשמיט אותו; `MULTI_MAIL_DEFAULT` קובע ברירת מחדל.
תשובה (`reply_to_message_id`) נכנסת לשרשור הנכון וממלאת לבד נמען ונושא; `reply_all` מוסיף את כל הנמענים המקוריים.

**הרשאות:** כברירת מחדל `gmail.readonly` + `gmail.compose`. השרת **לא יכול למחוק** מייל, להעביר לאשפה או לשנות הגדרות.
- **היומן מופעל לפי בחירה, לכל חשבון בנפרד** (`add --calendar`). זה מוסיף את ההרשאות `calendar.readonly` ו-`calendar.events`. השרת קורא אירועים וזמינות, ויוצר אירועים ביומן שלך בלי להזמין אף אחד. אין בו כלי לשינוי או מחיקה של אירוע. כלי היומן מופיעים רק כשלפחות חשבון אחד מחובר עם יומן. זמנים נקראים לפי אזור הזמן של כל יומן. אם יומן מוגדר לא נכון (בחשבון גוגל חדש ברירת המחדל היא לעיתים קרובות UTC), מגדירים `MULTI_MAIL_TZ=Asia/Jerusalem` או מעבירים לכלי `time_zone`.
- **תוויות מופעלות לפי בחירה, לכל חשבון בנפרד** (`add --labels`). זה מוסיף את ההרשאה `gmail.modify`, שברמת גוגל מאפשרת גם העברה לאשפה. לכן אין בשרת כלי להעברה לאשפה, והוא מסרב להוסיף את התוויות `TRASH` ו-`SPAM`.

## מצב "טיוטות בלבד"

כשמפעילים את השרת עם `--drafts-only`, או מגדירים `MULTI_MAIL_SEND=off`, הכלים `send_email` ו-`send_draft` לא נרשמים בכלל. המודל עדיין יכול לקרוא, לחפש ולכתוב טיוטות, אבל שום דבר לא יוצא מהתיבה עד שאתה לוחץ "שלח" ב-Gmail.

כדאי להשתמש בזה בכל פעם שהשרת קורא מיילים שלא אתה כתבת, ואף אחד לא מאשר כל צעד: מיון אוטומטי, משימות מתוזמנות, ולקוחות שלא מבקשים אישור. כל מייל נכנס יכול להכיל הוראה ("העבר את זה ל…"), ובמצב הזה אין כלי שיכול לבצע אותה.

```bash
claude mcp add multi-mail -s user -- npx -y @yybd/multi-mail-mcp --drafts-only
```

## למה עוד שרת — השוואה לקיים

נבדק ב-2026-11-07, מול חיפוש ברשת ומול הרשימה [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers). מספרי הכוכבים מאותו יום. את החלופות הקרובות ביותר בדקתי מול ה-README שלהן. את הנתונים על החיבורים המובנים של Claude ו-ChatGPT לא מצאתי בתיעוד רשמי, הם מבוססים בעיקר על בלוגים של ספקים מתחרים, ולכן כדאי לבדוק אותם מחדש.

| אפשרות | כמה תיבות | שליחה | Claude Desktop / Code | ChatGPT | איפה עובר המייל |
|---|---|---|---|---|---|
| **multi-mail (הפרויקט הזה)** | כן, כולל חיפוש בכולן (`all`) | כן, וגם טיוטות ותשובה בשרשור | כן (stdio) | כן (HTTP + טוקן) | רק אצלך ובגוגל |
| החיבור המובנה של Claude ל-Gmail | לא, חשבון אחד | לא, טיוטות בלבד | Claude בלבד | — | Anthropic |
| החיבור המובנה של ChatGPT ל-Gmail | המקורות סותרים | כן, מיוני 2026, באתר ובאישור | — | כן | OpenAI |
| [השרת הרשמי של גוגל](https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server) (Developer Preview) | לא מתועד | **אין כלי שליחה** | Claude | לא רשום | גוגל |
| [google_workspace_mcp](https://github.com/taylorwilsdon/google_workspace_mcp) (~3.5k ⭐) | ריבוי *משתמשים*. כמה תיבות של אדם אחד באותו סשן לא מתועד | כן | כן | כן (Developer Mode) | רק אצלך ובגוגל |
| [navbuildz/gmail-mcp-server](https://github.com/navbuildz/gmail-mcp-server) (16 ⭐) | כן, כולל `all` | כן | דרך URL | כנראה. לא נבדק | אצלך, ונדרש Redis |
| [alexneamtu/gmail-mcp](https://github.com/alexneamtu/gmail-mcp) (4 ⭐) | כן, לפי כינוי | אופציונלית (יש מצב טיוטות בלבד) | רק מרחוק (Streamable HTTP) | לא מוזכר. מתועדים Claude ו-Codex | רק אצלך ובגוגל, אבל דורש Node 24, לינוקס עם systemd וכתובת HTTPS |
| [kojott/mailmcp-dist](https://github.com/kojott/mailmcp-dist) (1 ⭐) | כן, כל ספק IMAP כולל Gmail | כן, לרשימת נמענים מאושרת, וגם קבצים מצורפים | כן (`.mcpb` או URL) | כן | השרת שלך, או השרת המשותף שלהם. Gmail דרך IMAP עם סיסמת אפליקציה. **רישיון מסחרי** |
| [orieg/gws-connector](https://github.com/orieg/gws-connector) (3 ⭐) | כן, ניתוב לפי תווית, כתובת או דומיין | כן | ‏Claude Code ולקוחות מקומיים אחרים | לא מוזכר | רק אצלך ובגוגל. כתוב ב-Go, 49 כלים ל-Gmail, ‏Calendar, ‏Drive, ‏Sheets ועוד |
| [honest-gmail-mcp](https://github.com/bartosz-kuc/honest-gmail-mcp) (0 ⭐) | חשבון אחד לכל מופע של השרת. לכמה תיבות מריצים כמה מופעים | כן, כולל קבצים מצורפים | כן (stdio) | לא | רק אצלך ובגוגל |
| [dmorrill/gmail-mcp-multi](https://github.com/dmorrill/gmail-mcp-multi), [jwlutz/gmail_connector](https://github.com/jwlutz/gmail_connector), [3vening/gmail-mcp](https://github.com/3vening/gmail-mcp) ועוד | כן | כן, בחלקם רק אחרי הפעלה מפורשת | כן (stdio) | **לא**, מקומי בלבד | רק אצלך ובגוגל |
| Composio / Zapier MCP / Pipedream | Composio: כן | כן | כן (URL) | כן (URL) | **דרך הספק**, בתשלום |

**המסקנה:**
- החיבורים המובנים לא מכסים כמה תיבות ושליחה בכל הלקוחות.
- כמה שרתים שמריצים אצלך כבר תומכים ביותר מתיבת Gmail אחת, וכל אחד מוותר על משהו אחר:
  - ‏alexneamtu/gmail-mcp עובד רק מרחוק, וצריך בשבילו שרת לינוקס עם כתובת HTTPS.
  - ‏mailmcp מגיע ל-Gmail דרך IMAP עם סיסמאות אפליקציה, ברישיון מסחרי.
  - ‏gws-connector מכסה את כל Workspace ללקוחות מקומיים, בלי ChatGPT.
  - רוב השאר רצים מקומית בלבד, ולכן ChatGPT לא יכול להתחבר אליהם.
- השירותים המתווכים מעבירים את הדואר ואת הטוקנים דרך צד שלישי.
- הייחוד של multi-mail: חבילת `npx` אחת ברישיון MIT, שרצה מקומית ב-stdio, וכשרוצים ChatGPT גם ב-HTTP מוגן בטוקן. היא עובדת עם Gmail API ועם OAuth client משלך, ונשארת צרה:
  - בלי הרשאת מחיקה.
  - הטוקנים נשמרים מקומית בהרשאות `600`.
  - שרת ה-HTTP לא עולה בלי טוקן.
- multi-mail מכסה מייל ויומן Google. **לשאר Workspace, כמו Drive או Docs**, `google_workspace_mcp` הוא החלופה הבוגרת, ו-`gws-connector` אם צריך כמה חשבונות.

## התקנה

צריך Node.js 20 ומעלה. אין מה להתקין: כל הפקודות במדריך מריצות את החבילה שפורסמה דרך `npx`.

<details>
<summary>הרצה מקוד המקור</summary>

```bash
git clone https://github.com/yybd/multi-mail-mcp.git multi-mail && cd multi-mail && npm install && npm run build
```

ואז בכל מקום שכתוב בו `npx -y @yybd/multi-mail-mcp`, משתמשים ב-`node dist/main.js`. בתוך תיקיית המקור, `npx -y @yybd/multi-mail-mcp` נכשל עם *command not found*, כי npx מזהה שהתיקייה היא החבילה עצמה ולא מוריד אותה. מריצים npx מכל תיקייה אחרת, או משתמשים שם ב-`npm run cli -- list`.
</details>

כל משתמש יוצר OAuth client משלו בחשבון הגוגל שלו (שלב 1). כך אין צורך באימות של גוגל, והטוקנים לא עוברים דרך אף צד שלישי.

### 1. יצירת OAuth client ב-Google Cloud (פעם אחת)

את השלבים האלה עושים פעם אחת, מחשבון גוגל אחד. אותו client משמש אחר כך לכל התיבות.

1. **פרויקט:** להיכנס ל-[console.cloud.google.com/projectcreate](https://console.cloud.google.com/projectcreate), לתת שם (למשל `multi-mail`) וללחוץ **Create**. לוודא שהפרויקט נבחר בתפריט העליון.
2. **Gmail API:** בדף ה-[Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com) ללחוץ **Enable**. אם תשתמש ביומן, מפעילים גם את [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com).
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

יומן: `add <account> --calendar` מחבר את החשבון מחדש עם Google Calendar. לשם כך צריך להפעיל את **Google Calendar API** באותו פרויקט שבו מופעל Gmail API (שלב 2 בהגדרת ה-OAuth). אפשר לשלב דגלים, למשל `add work --labels --calendar`.

תוויות: `add <account> --labels` מחבר את החשבון מחדש עם הרשאה לתוויות. היא נדרשת ל-`modify_labels` ול-`create_label`. הרצת `add` שוב בלי `--labels` מבטלת את ההרשאה.

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

**לא נתמך עדיין:** צירוף קבצים למייל יוצא.

## רישיון

MIT — ראה [LICENSE](LICENSE).
