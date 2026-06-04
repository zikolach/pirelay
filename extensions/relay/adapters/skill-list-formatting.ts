import { formatSkillList, type RemoteSkillSummary } from "../core/skill-invocation.js";

export function formatDiscordSkillList(skills: RemoteSkillSummary[]): string {
  return formatSkillList(skills, { commandStyle: "relay-prefix" });
}

export function formatSlackSkillList(skills: RemoteSkillSummary[]): string {
  return formatSkillList(skills, { commandStyle: "relay-prefix" });
}
