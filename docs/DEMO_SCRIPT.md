# Demo script (4 minutes)

Covers every item the brief asks the demo to show: a direct request, an indirect request, a workflow across three or more modules, a follow-up that changes it, ambiguity and a tool failure, and the benchmark results.

## Before recording

1. `npm start`, open http://localhost:8787, zoom the browser to 110–125%.
2. Check the sidebar shows **Connected · gpt-4.1-mini** and today's date.
3. Send one warm-up message, then click **Reset data** and **New chat**.
4. Run `npm run bench` beforehand and fill in the bracketed numbers in scene 7 from `server/results/BENCHMARK.md`.
5. Close other tabs, silence notifications, and keep `server/.env` off screen.

## Script

### 1. Opening (0:00 – 0:25)

_Show the welcome screen._

> Hi, I'm Thanushiya, and this is Ask AI.
>
> It lets someone run a business platform just by describing what they want. The platform has 50 modules, like contacts, leads, invoices and appointments, with 10 actions each: 500 in total.
>
> The idea behind the design is simple: the AI decides what needs to happen, and plain code carries it out. That's what makes it fast, cheap and safe. Let me show you.

### 2. A direct request (0:25 – 0:45)

_Type:_ `Create a contact named Sarah Lee with the email sarah.lee@acme.io`

> A direct request first. It found the right action out of 500 and filled in the details.

_Point at the footer, then open **Details → Data** and point at the highlighted contact. Close the panel._

> One action, about two seconds, a fraction of a cent. And the contact really exists in the data, highlighted as changed. Every action changes real state, so nothing can pretend to succeed.

### 3. An indirect request (0:45 – 1:10)

_Type:_ `I keep forgetting to follow up with new leads. Help me stay on top of them.`

> Now something people actually say: no command, just a problem.

_When the confirmation card appears:_

> It turned that into a plan: an automation that creates a follow-up task for every new lead. It also told me what it assumed. Turning on an automation affects real customers, so it asks for my approval first.

_Click **Yes, go ahead**._

### 4. A complex workflow, then a follow-up (1:10 – 2:15)

_Click **New chat**, then type:_
`Find leads created last week who have not replied, exclude anyone with a booked appointment, assign the remaining leads to available sales reps, and create follow-up tasks.`

_While it runs:_

> This is the hard one: several conditions across several modules. Notice the first sentence appears almost immediately, because the plan streams in while it's still being written.

_When it finishes, click **Show all steps**, then **Show technical names**._

> The plan touches leads, conversations, appointments, users and tasks. The interesting steps are these: removing people who replied, removing people who are booked, and sharing leads fairly between reps. None of them use the AI. They run as plain code, so they're exact every time. It also skipped Hannah, who is on leave this week.

_Click **View details**._

> Two AI calls in total: one to plan, one to write the answer. Everything else is code.

_Close the panel. In the same chat, type:_
`Only include leads from the Facebook campaign, and make those tasks due tomorrow.`

> And people change their minds. It remembers the exact tasks it just created, keeps only the Facebook ones and moves them to tomorrow. No duplicates, and I didn't have to repeat anything.

### 5. Ambiguity and safety (2:15 – 2:45)

_Click **New chat**, then type:_ `Send Sarah a text saying her demo was moved.`

> There are two Sarahs in the data. Instead of guessing, it asks.

_Click **Sarah Johnson**. The confirmation card appears._

> A text goes to a real customer, so it waits for my approval. This rule is enforced by the code, based on how risky each action is, so the AI can never skip it.

_Click **Yes, go ahead**._

### 6. A tool failure handled honestly (2:45 – 3:05)

_Type:_ `Text Laura Chen that her order is ready for pickup.`

> Laura has opted out of text messages. The action refuses, and the assistant tells me exactly why instead of pretending it worked. Failing clearly is part of being trustworthy.

### 7. The results (3:05 – 3:45)

_Open **Details → Benchmark** and scroll slowly._

> I wanted to prove the design, not just claim it. So I wrote down performance targets before measuring anything, then ran 114 scenarios covering all 50 modules through two versions: a simple baseline that gives the AI all 500 actions and works one step at a time, and my design.
>
> Mine costs **[X]** per request instead of **[Y]**, uses **[N]** AI calls instead of **[M]**, and gives a first useful response in **[time]** at the median. Task success is **[%]**, and it's measured on the final data, not on how the answer sounds.
>
> Where I missed a target, like **[one honest example]**, it's reported here with the reason.

### 8. Close (3:45 – 4:00)

_Return to the chat._

> Everything is reproducible: tests and the benchmark run on a fixed reference date with seeded data, there are more than 580 automated tests that need no API key, and one command regenerates every number.
>
> The part I enjoyed most was the trade-off thinking: deciding what the AI should do and what code should do. Thank you for watching.

## If something goes differently live

- **The AI takes a different but valid route** (for example, creating tasks instead of an automation): say what it did. "It chose to create tasks directly, which also solves the problem."
- **A step fails and repairs itself:** point it out. "It hit an error, saw exactly why, and fixed its own plan."
- **Something fails outright:** say what the failure shows ("it refused rather than guessing") and move on. Don't re-record over and over; honest narration is part of what's being judged.
- **The app is slow:** you can trim waiting time in editing, and say "cut for time".

## Recording tips

- QuickTime (File → New Screen Recording, with microphone) or Loom, at 1080p.
- Practise twice with a timer. By the third time it will sound like you.
- Speak a little slower than feels natural, and pause half a second after each click.
- Slow down on the key line, "the AI decides what needs to happen, and plain code carries it out", because it's the whole design in one sentence.
- Keep the mouse still while talking.
- Upload as YouTube (unlisted) or Loom, and put the link at the top of the README.
