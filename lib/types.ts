export interface Organization {
  id: string;
  name: string;
  domain: string;
  website: string;
  country: string;
  kind: string;
  relevance: string;
  contact_channel: string | null;
  status: string;
  verified_at: string | null;
  next_action: string | null;
  demo: boolean;
  created_at: string;
}
export interface Contact {
  id: string;
  organization_id: string;
  name: string | null;
  role: string | null;
  email: string;
  evidence_url: string;
  verified_at: string | null;
  do_not_contact: boolean;
}
export interface Evidence {
  id: string;
  organization_id: string;
  url: string;
  note: string;
  checked_at: string | null;
}
export interface Message {
  id: string;
  revision: number;
  organization_id: string;
  contact_id: string;
  organization: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  parent_id: string | null;
  sent_at: string | null;
  created_at: string;
  last_error: string | null;
  smtp_message_id: string | null;
}
export interface Event {
  id: string;
  message_id: string;
  kind: string;
  detail: string;
  created_at: string;
}
export interface Partner {
  id: string;
  organization_id: string;
  organization: string;
  url: string;
  channel: string;
  terms: string | null;
  terms_evidence_url: string | null;
  materials: string;
  draft: string;
  status: string;
  created_at: string;
}
export interface Task {
  id: string;
  organization_id: string | null;
  organization: string | null;
  message_id: string | null;
  title: string;
  due_at: string;
  kind: string;
  status: string;
  created_at: string;
}
export interface Opportunity {
  id: string;
  organization: string;
  organization_id: string;
  stage: string;
  notes: string;
  value: string | null;
  currency: string;
  created_at: string;
}
export interface Spend {
  id: string;
  category: string;
  label: string;
  amount: string;
  currency: string;
  day: string;
  confirmation: string;
  evidence_url: string | null;
}
export interface Campaign {
  account_id: string;
  external_id: string;
  name: string;
  currency: string;
  source: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
}
export interface Activity {
  id: string;
  actor: string;
  action: string;
  entity_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}
export interface Job {
  id: string;
  job_key: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  result: Record<string, unknown> | null;
}
export interface Integration {
  name: string;
  status: string;
  last_success_at: string | null;
  detail: string | null;
}
export interface Discovery {
  id: string;
  query: string;
  title: string;
  url: string;
  description: string | null;
  status: string;
}
export interface DashboardData {
  organizations: Organization[];
  contacts: Contact[];
  evidence: Evidence[];
  messages: Message[];
  events: Event[];
  partners: Partner[];
  tasks: Task[];
  opportunities: Opportunity[];
  opportunityEvents: {
    id: string;
    opportunity_id: string;
    stage: string;
    entered_at: string;
  }[];
  spend: Spend[];
  campaigns: Campaign[];
  activity: Activity[];
  jobs: Job[];
  integrations: Integration[];
  discoveries: Discovery[];
  metrics: Record<string, number>;
  totals: { currency: string; source: string; amount: number }[];
  reports: {
    week: string;
    report: {
      sent: { organization: string; recipient: string; subject: string }[];
      replies: { organization: string; kind: string; detail: string }[];
      opportunities: { organization: string; stage: string; notes: string }[];
      spend: { currency: string; amount: number }[];
    };
    generated_at: string;
  }[];
  weeklySpend: { week: string; currency: string; amount: number }[];
  weekly: {
    week: string;
    sent: number;
    replies: number;
    negotiations: number;
    proposals: number;
    won: number;
  }[];
  connections: Record<string, boolean>;
  budgets: Record<string, number>;
}
