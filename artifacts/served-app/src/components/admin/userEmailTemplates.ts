/**
 * Ready-made message templates an admin can pick from the Users drawer and
 * tweak before sending. Each template is plain text (no HTML) so it reads
 * the same in every email client. `{name}` is replaced with the user's
 * first name (or a friendly fallback) at selection time.
 */
export interface UserEmailTemplate {
  id: string;
  label: string;
  subject: string;
  body: string;
}

export const USER_EMAIL_TEMPLATES: UserEmailTemplate[] = [
  {
    id: "welcome",
    label: "Welcome / getting started",
    subject: "Welcome to SERVED.",
    body: [
      "Hi {name},",
      "",
      "Thanks for creating your SERVED. account — we're glad you're here.",
      "",
      "Whenever you're ready, you can post your first job in just a couple of",
      "minutes: enter who needs to be served, upload your documents, and we'll",
      "take it from there. You'll get court-ready proof of service without the",
      "back-and-forth phone calls.",
      "",
      "If anything is unclear or you'd like a hand getting started, just reply",
      "to this email — I'm happy to help.",
      "",
      "Best,",
      "The SERVED. Team",
    ].join("\n"),
  },
  {
    id: "no_job_yet",
    label: "Signed up but no job posted yet",
    subject: "Need a hand posting your first job?",
    body: [
      "Hi {name},",
      "",
      "I noticed you signed up for SERVED. but haven't posted a job yet — I",
      "wanted to check in and make sure nothing is getting in your way.",
      "",
      "Posting a job is quick: tell us who needs to be served and where, upload",
      "your documents, and a process server takes it from there. You'll be able",
      "to track every attempt and download proof of service when it's done.",
      "",
      "If you have a serve coming up, I'd love to help you get it set up. Just",
      "reply here and let me know.",
      "",
      "Best,",
      "The SERVED. Team",
    ].join("\n"),
  },
  {
    id: "check_in",
    label: "Friendly check-in",
    subject: "Checking in from SERVED.",
    body: [
      "Hi {name},",
      "",
      "Just checking in to see how things are going with SERVED. and whether",
      "there's anything I can do to make process serving easier for you.",
      "",
      "If you have questions about pricing, turnaround times, or how the",
      "platform works, reply to this email and I'll get you answers.",
      "",
      "Best,",
      "The SERVED. Team",
    ].join("\n"),
  },
  {
    id: "blank",
    label: "Blank message",
    subject: "",
    body: "",
  },
];

/** Substitute {name} with the user's first name or a friendly fallback. */
export function fillTemplate(text: string, firstName?: string | null): string {
  const name = firstName?.trim() || "there";
  return text.replace(/\{name\}/g, name);
}
