export const SUGGESTIONS = [
  {
    icon: 'users',
    kind: 'Simple task',
    title: 'Add a new contact',
    prompt: 'Create a contact named Sarah Lee with the email sarah.lee@acme.io',
  },
  {
    icon: 'spark',
    kind: 'Goal, not a command',
    title: 'Never miss a follow-up',
    prompt: 'I keep forgetting to follow up with new leads. Help me stay on top of them.',
  },
  {
    icon: 'route',
    kind: 'Multi-step workflow',
    title: 'Follow up with quiet leads',
    prompt:
      'Find leads created last week who have not replied, exclude anyone with a booked appointment, assign the remaining leads to available sales reps, and create follow-up tasks.',
  },
  {
    icon: 'filter',
    kind: 'With conditions',
    title: 'Chase overdue invoices',
    prompt:
      'For unpaid invoices overdue by more than 15 days, draft reminders, but skip customers who already received one this week.',
  },
  {
    icon: 'chart',
    kind: 'Question about your data',
    title: 'Brief me on a customer',
    prompt:
      'Give me a quick brief on Sarah Johnson: her open deals, unpaid invoices and upcoming appointments.',
  },
  {
    icon: 'help',
    kind: 'Needs a detail from you',
    title: 'Text a customer',
    prompt: 'Send Sarah a text saying her demo was moved.',
  },
];

export const MORE_EXAMPLES = [
  'Only include leads from the Facebook campaign, and make those tasks due tomorrow.',
  "Hannah is out this week — make sure her work doesn't fall through the cracks.",
  'Approve refund requests under $50 and reject the rest.',
  "What's our NPS from the Customer NPS Q3 survey?",
  'Void invoice INV-1060.',
  'Text Laura Chen that her order is ready for pickup.',
  'Post our fall promo on Instagram.',
];
