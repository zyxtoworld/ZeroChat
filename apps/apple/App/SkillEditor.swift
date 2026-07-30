import SwiftUI
import ZeroChatCore

struct NativeSkillEditor: View {
    let skill: UserSkill
    let i18n: NativeI18n
    let onSave: (String, String) -> Void
    let onToggle: (UserSkill) -> Void
    let onDelete: () -> Void
    @State private var name: String
    @State private var content: String

    init(
        skill: UserSkill,
        i18n: NativeI18n,
        onSave: @escaping (String, String) -> Void,
        onToggle: @escaping (UserSkill) -> Void,
        onDelete: @escaping () -> Void
    ) {
        self.skill = skill
        self.i18n = i18n
        self.onSave = onSave
        self.onToggle = onToggle
        self.onDelete = onDelete
        _name = State(initialValue: skill.name)
        _content = State(initialValue: nativeSkillContent(skill))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField(i18n.t("field.skillName"), text: $name)
            Text(skillMetaText(skill, i18n))
                .foregroundStyle(.secondary)
            Toggle(i18n.t("field.enabled"), isOn: Binding(
                get: { skill.enabled },
                set: { onToggle(skill.with(enabled: $0)) }
            ))
            Toggle(i18n.t("label.skillFixed"), isOn: Binding(
                get: { skill.fixed },
                set: { onToggle(skill.with(fixed: $0)) }
            ))
            Toggle(i18n.t("label.skillAutoMatch"), isOn: Binding(
                get: { skill.autoMatch },
                set: { onToggle(skill.with(autoMatch: $0)) }
            ))
            TextEditor(text: $content)
                .frame(minHeight: 100)
            HStack {
                Button(i18n.t("button.save")) {
                    onSave(name, content)
                }
                .disabled(content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Button(i18n.t("button.deleteSkill"), role: .destructive) {
                    onDelete()
                }
            }
        }
        .padding(.vertical, 6)
    }
}

private extension UserSkill {
    func with(enabled: Bool) -> UserSkill {
        var copy = self
        copy.enabled = enabled
        copy.updatedAt = nowMillis()
        return copy
    }

    func with(fixed: Bool) -> UserSkill {
        var copy = self
        copy.fixed = fixed
        copy.updatedAt = nowMillis()
        return copy
    }

    func with(autoMatch: Bool) -> UserSkill {
        var copy = self
        copy.autoMatch = autoMatch
        copy.updatedAt = nowMillis()
        return copy
    }
}
