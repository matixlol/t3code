import {
  DEFAULT_CLIENT_SETTINGS,
  type PromptLinkDefaultProject,
} from "@t3tools/contracts/settings";

import { updateClientSettings, useClientSettings } from "~/hooks/useSettings";
import { useProjects } from "~/state/entities";
import { useEnvironments } from "~/state/environments";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const NONE = "none";
const LAST_USED = "last-used";
const projectValue = (environmentId: string, projectId: string) =>
  `project:${environmentId}:${projectId}`;

export function PromptLinkDefaultProjectRow() {
  const setting = useClientSettings((settings) => settings.promptLinkDefaultProject);
  const projects = useProjects().filter((project) => project.isScratch !== true);
  const { environments } = useEnvironments();
  const showEnvironment = new Set(projects.map((project) => project.environmentId)).size > 1;
  const environmentLabel = (environmentId: string) =>
    environments.find((environment) => environment.environmentId === environmentId)?.label;

  const options = new Map<string, { label: string; setting: PromptLinkDefaultProject }>([
    [NONE, { label: "No project", setting: { kind: "none" } }],
    [LAST_USED, { label: "Last used project", setting: { kind: "last-used" } }],
  ]);
  for (const project of projects) {
    const environment = showEnvironment ? environmentLabel(project.environmentId) : undefined;
    options.set(projectValue(project.environmentId, project.id), {
      label: environment ? `${project.title} · ${environment}` : project.title,
      setting: { kind: "project", environmentId: project.environmentId, projectId: project.id },
    });
  }
  const value =
    setting.kind === "project"
      ? projectValue(setting.environmentId, setting.projectId)
      : setting.kind;
  const missing = !options.has(value);

  return (
    <SettingsRow
      {...searchableSetting("prompt-link-default-project")}
      description="Where links without a repository open, such as Linear's Start working in T3 Code."
      status={missing ? "The chosen project is gone, so these links open without a project." : null}
      resetAction={
        setting.kind !== DEFAULT_CLIENT_SETTINGS.promptLinkDefaultProject.kind ? (
          <SettingResetButton
            label="links without a repository"
            onClick={() =>
              void updateClientSettings({
                promptLinkDefaultProject: DEFAULT_CLIENT_SETTINGS.promptLinkDefaultProject,
              })
            }
          />
        ) : null
      }
      control={
        <Select
          value={value}
          onValueChange={(next) => {
            const option = next === null ? undefined : options.get(next);
            if (option) void updateClientSettings({ promptLinkDefaultProject: option.setting });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Links open in">
            <SelectValue>{options.get(value)?.label ?? "Removed project"}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {[...options].map(([key, option]) => (
              <SelectItem hideIndicator key={key} value={key}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
