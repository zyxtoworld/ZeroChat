import type { RefObject } from 'react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { UserSkill } from '../types'
import {
  INITIAL_SKILL_RENDER_COUNT,
  deriveRenderedSkillList,
  nextSkillRenderCount,
  skillRenderCountForTargetIndex,
} from './settingsSkillList'

interface UseSettingsSkillListControllerOptions {
  editingSkillId: string
  scrollSettingsTargetIntoView: (target: HTMLElement) => void
  settingsModalRef: RefObject<HTMLElement | null>
  settingsOpen: boolean
  settingsTab: string
  skills: UserSkill[]
}

export function useSettingsSkillListController({
  editingSkillId,
  scrollSettingsTargetIntoView,
  settingsModalRef,
  settingsOpen,
  settingsTab,
  skills,
}: UseSettingsSkillListControllerOptions) {
  const [renderedSkillCount, setRenderedSkillCount] = useState(
    INITIAL_SKILL_RENDER_COUNT,
  )
  const [pendingSkillRevealId, setPendingSkillRevealId] = useState('')
  const skillListMoreRef = useRef<HTMLDivElement | null>(null)
  const skillsTabActive = settingsTab === 'skills'
  const {
    hasMoreRenderedSkills,
    renderedSkillLimit,
    renderedSkills,
    skillCount,
  } = useMemo(
    () => deriveRenderedSkillList(skills, renderedSkillCount, skillsTabActive),
    [renderedSkillCount, skills, skillsTabActive],
  )

  const resetRenderedSkillList = useCallback(() => {
    setRenderedSkillCount(INITIAL_SKILL_RENDER_COUNT)
  }, [])

  const requestSkillReveal = useCallback((skillId: string) => {
    setPendingSkillRevealId(skillId)
  }, [])

  const showMoreSkills = useCallback(() => {
    setRenderedSkillCount((current) =>
      nextSkillRenderCount(current, skillCount),
    )
  }, [skillCount])

  useEffect(() => {
    if (!skillsTabActive) {
      return
    }

    const targetSkillId = pendingSkillRevealId || editingSkillId

    if (!targetSkillId) {
      return
    }

    const targetIndex = skills.findIndex((skill) => skill.id === targetSkillId)

    const handle = window.setTimeout(() => {
      setRenderedSkillCount((current) =>
        skillRenderCountForTargetIndex(current, skillCount, targetIndex),
      )
    }, 0)

    return () => window.clearTimeout(handle)
  }, [editingSkillId, pendingSkillRevealId, skillCount, skills, skillsTabActive])

  useEffect(() => {
    if (
      !settingsOpen ||
      !skillsTabActive ||
      !hasMoreRenderedSkills ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return
    }

    const target = skillListMoreRef.current

    if (!target) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          showMoreSkills()
        }
      },
      {
        root: settingsModalRef.current,
        rootMargin: '240px 0px',
      },
    )

    observer.observe(target)

    return () => {
      observer.disconnect()
    }
  }, [
    hasMoreRenderedSkills,
    settingsModalRef,
    settingsOpen,
    showMoreSkills,
    skillsTabActive,
  ])

  useEffect(() => {
    const skillId = pendingSkillRevealId

    if (
      !skillId ||
      !settingsOpen ||
      !skillsTabActive ||
      !skills.some((skill) => skill.id === skillId)
    ) {
      return
    }

    const handle = window.setTimeout(() => {
      const target = Array.from(
        settingsModalRef.current?.querySelectorAll<HTMLElement>(
          '[data-skill-id]',
        ) ?? [],
      ).find((item) => item.getAttribute('data-skill-id') === skillId)

      if (target) {
        setPendingSkillRevealId('')
        scrollSettingsTargetIntoView(target)
      }
    }, 0)

    return () => window.clearTimeout(handle)
  }, [
    renderedSkillLimit,
    pendingSkillRevealId,
    scrollSettingsTargetIntoView,
    settingsModalRef,
    settingsOpen,
    skills,
    skillsTabActive,
  ])

  return {
    hasMoreRenderedSkills,
    renderedSkillLimit,
    renderedSkills,
    requestSkillReveal,
    resetRenderedSkillList,
    showMoreSkills,
    skillCount,
    skillListMoreRef,
  }
}
