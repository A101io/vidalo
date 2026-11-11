/** The online questions in English, key for key and in the same order as online.ts (test/online-templates.test.ts). */
import type { OnlineTemplate } from "./online";

export const ONLINE_TEMPLATES_EN: OnlineTemplate[] = [
  { key: "online.existence.exists", family: "existence", intent: null, text: "Does {name} still exist?", slots: ["name"] },
  { key: "online.existence.active", family: "existence", intent: null, text: "Is {name} still in business?", slots: ["name"] },
  { key: "online.what", family: "what", intent: null, text: "What does {name} do?", slots: ["name"] },
  { key: "online.website", family: "website", intent: null, text: "What is the website of {name}?", slots: ["name"] },
  { key: "online.phone", family: "phone", intent: null, text: "What is the phone number of {name}?", slots: ["name"] },
  { key: "online.rec.audience", family: "rec_category", intent: "specialty", text: "Which {category} is good for {audience}?", slots: ["category", "audience"] },
  { key: "online.rec.quality", family: "rec_category", intent: "quality", text: "What is the best {category}?", slots: ["category"] },
  { key: "online.rec.trust", family: "rec_category", intent: "trust", text: "Which {category} do you recommend?", slots: ["category"] },
  { key: "online.rec.price", family: "rec_category", intent: "price", text: "Which {category} is affordable?", slots: ["category"] },
  { key: "online.alt.self", family: "alternative", intent: "alternative", text: "What is a good alternative to {name}?", slots: ["name"] },
  { key: "online.alt.competitor", family: "alternative", intent: "alternative", text: "What is a good alternative to {competitor}?", slots: ["competitor"] },
];
