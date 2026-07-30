import SwiftUI
import Foundation
import UniformTypeIdentifiers
import ZeroChatCore

private let skillListInitialRenderLimit = 80
private let skillListRenderBatch = 80

struct SkillSettingsView: View {
    @ObservedObject var model: ZeroChatViewModel
    let i18n: NativeI18n
    @State private var skillNameDraft = ""
    @State private var skillContentDraft = ""
    @State private var renderedSkillLimit = skillListInitialRenderLimit
    @State private var skillImporterPresented = false

    var body: some View {
        let settings = model.snapshot.skillSettings ?? SkillSettings()
        let allSkills = model.snapshot.skills ?? []
        let shownSkillCount = min(renderedSkillLimit, allSkills.count)
        let visibleSkills = Array(allSkills.prefix(renderedSkillLimit))

        return Section(i18n.t("setting.skills")) {
            Text(i18n.t("settings.skillsHelp"))
                .foregroundStyle(.secondary)
            Toggle(i18n.t("label.skillGlobalAutoMatch"), isOn: Binding(
                get: { settings.autoMatch },
                set: { value in
                    var next = model.snapshot
                    next.skillSettings = SkillSettings(
                        autoMatch: value,
                        contextBudget: settings.contextBudget,
                        maxAutoSkills: settings.maxAutoSkills
                    )
                    model.commit(next)
                }
            ))
            Stepper(value: Binding(
                get: { settings.contextBudget },
                set: { value in
                    var next = model.snapshot
                    next.skillSettings = SkillSettings(
                        autoMatch: settings.autoMatch,
                        contextBudget: min(max(value, 600), 8000),
                        maxAutoSkills: settings.maxAutoSkills
                    )
                    model.commit(next)
                }
            ), in: 600...8000, step: 200) {
                Text("\(i18n.t("field.skillContextBudget")): \(settings.contextBudget)")
            }
            Stepper(value: Binding(
                get: { settings.maxAutoSkills },
                set: { value in
                    var next = model.snapshot
                    next.skillSettings = SkillSettings(
                        autoMatch: settings.autoMatch,
                        contextBudget: settings.contextBudget,
                        maxAutoSkills: min(max(value, 1), 8)
                    )
                    model.commit(next)
                }
            ), in: 1...8) {
                Text("\(i18n.t("field.skillAutoCount")): \(settings.maxAutoSkills)")
            }
            Text(i18n.t("settings.skillBudgetNote"))
                .foregroundStyle(.secondary)
            Button {
                skillImporterPresented = true
            } label: {
                Label(i18n.t("button.importSkill"), systemImage: "square.and.arrow.down")
            }

            if allSkills.isEmpty {
                Text(i18n.t("settings.skillsEmpty"))
                    .foregroundStyle(.secondary)
            } else {
                if shownSkillCount < allSkills.count {
                    skillListProgressControls(shown: shownSkillCount, total: allSkills.count)
                }

                ForEach(visibleSkills) { skill in
                    NativeSkillEditor(
                        skill: skill,
                        i18n: i18n,
                        onSave: { name, content in saveSkill(skill, name: name, content: content) },
                        onToggle: { updated in upsertSkill(updated) },
                        onDelete: { deleteSkill(skill) }
                    )
                }
                if shownSkillCount < allSkills.count {
                    Text(skillListProgressText(i18n, shown: shownSkillCount, total: allSkills.count))
                        .foregroundStyle(.secondary)
                    Button {
                        renderedSkillLimit = min(renderedSkillLimit + skillListRenderBatch, allSkills.count)
                    } label: {
                        Label(i18n.t("button.showMoreSkills"), systemImage: "chevron.down")
                    }
                }
            }

            TextField(i18n.t("field.skillName"), text: $skillNameDraft)
            TextEditor(text: $skillContentDraft)
                .frame(minHeight: 120)
                .overlay(alignment: .topLeading) {
                    if skillContentDraft.isEmpty {
                        Text(i18n.t("placeholder.skillContent"))
                            .foregroundStyle(.secondary)
                            .padding(.top, 8)
                            .padding(.leading, 4)
                    }
                }
            Button(i18n.t("button.addSkill")) {
                addDraftSkill()
            }
            .disabled(skillContentDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .fileImporter(
            isPresented: $skillImporterPresented,
            allowedContentTypes: [.plainText, .json, UTType(filenameExtension: "md") ?? .plainText, .data],
            allowsMultipleSelection: false
        ) { result in
            importSkill(result)
        }
        .onAppear {
            renderedSkillLimit = skillListInitialRenderLimit
        }
    }

    private func skillListProgressControls(
        shown: Int,
        total: Int
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(skillListProgressText(i18n, shown: shown, total: total))
                .foregroundStyle(.secondary)
            Button {
                renderedSkillLimit = min(renderedSkillLimit + skillListRenderBatch, total)
            } label: {
                Label(i18n.t("button.showMoreSkills"), systemImage: "chevron.down")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func addDraftSkill() {
        guard !skillContentDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            model.settingsNotice = AppNotice(message: i18n.t("notice.skillContentRequired"), kind: .warning)
            return
        }

        let skill = makeNativeSkill(
            name: skillNameDraft.isEmpty ? i18n.t("fallback.skillName") : skillNameDraft,
            content: skillContentDraft,
            contentType: "text",
            fallbackSkillName: i18n.t("fallback.skillName"),
            fallbackHeading: i18n.t("fallback.skillHeading")
        )
        var next = model.snapshot
        next.skills = [skill] + (next.skills ?? [])
        model.commit(next)
        skillNameDraft = ""
        skillContentDraft = ""
        model.settingsNotice = AppNotice(message: i18n.t("notice.skillAdded"), kind: .success)
    }

    private func importSkill(_ result: Result<[URL], Error>) {
        do {
            guard let url = try result.get().first else { return }
            let shouldStop = url.startAccessingSecurityScopedResource()
            defer {
                if shouldStop {
                    url.stopAccessingSecurityScopedResource()
                }
            }

            let content = try readBoundedLocalFileText(
                at: url,
                maxBytes: maxSkillFileBytes
            )
            let contentType = skillContentType(fileName: url.lastPathComponent)
            let name = url.deletingPathExtension().lastPathComponent
            let skill = makeNativeSkill(
                name: name.isEmpty ? i18n.t("fallback.skillName") : name,
                content: content,
                contentType: contentType,
                fileName: url.lastPathComponent,
                fallbackSkillName: i18n.t("fallback.skillName"),
                fallbackHeading: i18n.t("fallback.skillHeading")
            )
            var next = model.snapshot
            next.skills = [skill] + (next.skills ?? [])
            model.commit(next)
            model.settingsNotice = AppNotice(
                message: i18n.t("notice.skillImported").replacingOccurrences(of: "{count}", with: "1"),
                kind: .success
            )
        } catch {
            model.settingsNotice = AppNotice(
                message: i18n.t("notice.skillImportFailed")
                    .replacingOccurrences(of: "{message}", with: i18n.errorMessage(error)),
                kind: .error
            )
        }
    }

    private func saveSkill(_ skill: UserSkill, name: String, content: String) {
        guard !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        upsertSkill(
            makeNativeSkill(
                name: name.isEmpty ? skill.name : name,
                content: content,
                contentType: skill.contentType,
                fileName: skill.fileName,
                id: skill.id,
                createdAt: skill.createdAt,
                fixed: skill.fixed,
                enabled: skill.enabled,
                autoMatch: skill.autoMatch,
                fallbackSkillName: i18n.t("fallback.skillName"),
                fallbackHeading: i18n.t("fallback.skillHeading")
            )
        )
        model.settingsNotice = AppNotice(message: i18n.t("notice.skillSaved"), kind: .success)
    }

    private func upsertSkill(_ skill: UserSkill) {
        var next = model.snapshot
        next.skills = (next.skills ?? []).map { $0.id == skill.id ? skill : $0 }
        model.commit(next)
    }

    private func deleteSkill(_ skill: UserSkill) {
        var next = model.snapshot
        next.skills = (next.skills ?? []).filter { $0.id != skill.id }
        model.commit(next)
        model.settingsNotice = AppNotice(message: i18n.t("notice.skillDeleted"), kind: .success)
    }
}
