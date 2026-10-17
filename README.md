# Pakka

**An AI order copilot for small businesses that sell on WhatsApp.**

Home bakers, jewellery makers and saree sellers negotiate custom orders over days of chat: texts, photos, payment screenshots, and changes of mind. The current agreed version of an order is never written down, so details get missed. Pakka reads the order chats and keeps one live ticket per order, with every detail linked to the message it came from, a history of changes, and flags only for what needs the owner's attention.

- **Catches changes:** a change the business agrees to in chat updates the order on its own, and the old value is kept.
- **Grounded:** every detail needs the exact words from the chat, checked by code. The AI never writes to the database.
- **Safe:** payments are always "not verified" until the owner checks, and Pakka never messages customers.

Status: working prototype, demoed with a home bakery and a simulator. Built for the Codebasics AI PM Bootcamp (BYOP capstone). Everything here uses **synthetic data only**.

## Project documents

| Document | Where |
| --- | --- |
| AI PRD | [Open the PRD (Word Doc)](docs/Capstone_Pooja_Pakka_AI_PRD.docx) | 
| Presentation | [Open the deck (PDF)](docs/Capstone_Pooja_Pakka_Presentation.pdf) |
| Cost estimate | [Download the workbook (Excel)](docs/Capstone_Pooja_Pakka_Cost_Estimation.xlsx) |
| Eval results | [Read the eval results](docs/EVAL_RESULTS.md) |
| Opportunity map (FigJam) | [Open the board](https://www.figma.com/board/66DAEYQ63KeV5oMLsGJe5n/CapstoneBYOP_Pooja_AI-Opportunity-Map) |
| Design (Figma) | [Open the designs](https://www.figma.com/design/3QEBLyRLp0qeIizbC4MX8O/Capstone_BYOP_Pooja_Pakka) |
| Demo video | [Watch the demo](https://www.loom.com/share/83f8e93cad3c47b9b3c8d3cca7f2b45d) |

## Quick start for reviewers

- **Live app:** https://pakka-app.vercel.app. Without the passcode it is read-only. The passcode is in the submission notes.
- **Try it:** open `/simulator`, enter the passcode, choose S2 "Change agreed in chat", and press "Send next message" repeatedly. A customer's request waits as pending until the business agrees, then becomes "Updated from chat". Open Rahul's order to see sources, payments and history.
- **Run it yourself:** see "Run it locally" below.