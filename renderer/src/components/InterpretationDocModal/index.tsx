import { useEffect, useState } from 'react'
import { Button, Modal, Segmented, Space, Spin, Tabs, Typography, message } from 'antd'
import RichEditorPane from './RichEditorPane'
import { markdownToHtml } from '../../utils/markdownToHtml'
import styles from './index.module.less'

const { Text } = Typography

export type InterpretationDocModalProps = {
  open: boolean
  onClose: () => void
  /** 弹窗标题 */
  title?: string
  loading?: boolean
  zhContent: string
  enContent: string
  /** 是否在底部展示「补充说明」区块（仅运行记录等场景） */
  showNotes?: boolean
  noteZh?: string
  noteEn?: string
  onNoteZhChange?: (v: string) => void
  onNoteEnChange?: (v: string) => void
  onSaveNotes?: () => void
  onShowInFolder?: () => void
}

type ViewMode = 'read' | 'edit'

/**
 * 结果解读稿：弹窗 + 纸张式阅读；可选富文本编辑并导出 Word。
 */
export default function InterpretationDocModal({
  open,
  onClose,
  title = '结果解读（文档视图）',
  loading = false,
  zhContent,
  enContent,
  showNotes = false,
  noteZh = '',
  noteEn = '',
  onNoteZhChange,
  onNoteEnChange,
  onSaveNotes,
  onShowInFolder,
}: InterpretationDocModalProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('read')
  const [htmlZh, setHtmlZh] = useState('')
  const [htmlEn, setHtmlEn] = useState('')
  const [activeEditLang, setActiveEditLang] = useState<'zh' | 'en'>('zh')

  /** 从 Markdown 原文同步到富文本（打开弹窗或加载完成后） */
  useEffect(() => {
    if (!open || loading) return
    setHtmlZh(markdownToHtml(zhContent))
    setHtmlEn(markdownToHtml(enContent))
  }, [open, loading, zhContent, enContent])

  useEffect(() => {
    if (!open) setViewMode('read')
  }, [open])

  const reloadFromMarkdown = () => {
    setHtmlZh(markdownToHtml(zhContent))
    setHtmlEn(markdownToHtml(enContent))
    message.info('已从当前 Markdown 原文重新载入')
  }

  const exportToWord = async (html: string, defaultFileName: string) => {
    const savePath = await window.electronAPI.selectSavePath({
      defaultPath: defaultFileName,
      filters: [{ name: 'Word 文档', extensions: ['docx'] }],
    })
    if (!savePath) return
    const res = await window.electronAPI.exportHtmlToDocx(html, savePath)
    if (res.success) message.success(`已保存 Word：${savePath}`)
    else message.error(res.error || '导出失败')
  }

  const handleExportCurrent = () => {
    const body = activeEditLang === 'zh' ? htmlZh : htmlEn
    const h1 = activeEditLang === 'zh' ? '中文稿' : 'English draft'
    const html = `<article><h1>${h1}</h1>${body}</article>`
    const name = activeEditLang === 'zh' ? 'FigForge_解读稿_中文.docx' : 'FigForge_解读稿_English.docx'
    void exportToWord(html, name)
  }

  const handleExportCombined = () => {
    const html = `<div><article><h1>中文稿</h1>${htmlZh}</article><div class="page-break" style="page-break-after: always;"></div><article><h1>English draft</h1>${htmlEn}</article></div>`
    void exportToWord(html, 'FigForge_解读稿_中英.docx')
  }

  const draftTabsRead = [
    {
      key: 'zh',
      label: '中文稿',
      children: (
        <div className={styles.paper}>
          {zhContent ? (
            zhContent
          ) : (
            <span className={styles.paperEmpty}>暂无中文解读稿（请先成功运行 Pipeline 并生成 _pipeline/interpretation_zh.md）</span>
          )}
        </div>
      ),
    },
    {
      key: 'en',
      label: '英文稿',
      children: (
        <div className={styles.paper}>
          {enContent ? (
            enContent
          ) : (
            <span className={styles.paperEmpty}>No English draft yet.</span>
          )}
        </div>
      ),
    },
  ]

  const editTabs = [
    {
      key: 'zh',
      label: '中文稿',
      children: (
        <RichEditorPane
          value={htmlZh}
          onChange={setHtmlZh}
          placeholder="在此编辑中文解读稿，可设置标题、颜色、列表等…"
        />
      ),
    },
    {
      key: 'en',
      label: '英文稿',
      children: (
        <RichEditorPane
          value={htmlEn}
          onChange={setHtmlEn}
          placeholder="Edit English draft…"
        />
      ),
    },
  ]

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      width={980}
      style={{ top: 24 }}
      footer={
        <Space wrap>
          {onShowInFolder && (
            <Button
              onClick={() => {
                void onShowInFolder()
              }}
            >
              在文件夹中显示
            </Button>
          )}
          <Button type="primary" onClick={onClose}>
            关闭
          </Button>
        </Space>
      }
      destroyOnClose
    >
      <div className={styles.wrap}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <Spin tip="加载解读稿…" />
          </div>
        ) : (
          <>
            <div className={styles.viewModeTabs}>
              <Segmented
                options={[
                  { label: '阅读', value: 'read' },
                  { label: '编辑与导出 Word', value: 'edit' },
                ]}
                value={viewMode}
                onChange={(v) => setViewMode(v as ViewMode)}
              />
            </div>

            {viewMode === 'read' ? (
              <>
                <div className={styles.toolbar}>
                  <Text type="secondary">
                    以下为自动生成的写作骨架（Markdown 原文）。切换到「编辑与导出 Word」可排版并另存为 .docx。
                  </Text>
                </div>
                <Tabs size="small" items={draftTabsRead} />

                {showNotes && (
                  <div className={styles.notesSection}>
                    <div className={styles.notesHint}>
                      <strong>补充说明是做什么的？</strong>
                      用于在本机记录<strong>与本次运行相关的个人备忘</strong>，例如：准备写进论文的句子、对自动解读稿的修改要点、审稿意见回复草稿、组会汇报要点等。
                      内容<strong>只保存在 FigForge「运行记录」</strong>里，不会写入分析输出目录，也不会随结果文件夹一起拷贝给别人。
                    </div>
                    <div className={styles.notesPaper}>
                      <Tabs
                        size="small"
                        items={[
                          {
                            key: 'nzh',
                            label: '中文补充',
                            children: (
                              <textarea
                                className={styles.noteTextarea}
                                value={noteZh}
                                onChange={(e) => onNoteZhChange?.(e.target.value)}
                                placeholder="可在此记录论文用语、修改提纲、审稿回复要点…"
                                rows={10}
                                style={{
                                  width: '100%',
                                  resize: 'vertical',
                                  padding: 10,
                                  borderRadius: 6,
                                  border: '1px solid #d9d9d9',
                                }}
                              />
                            ),
                          },
                          {
                            key: 'nen',
                            label: '英文补充',
                            children: (
                              <textarea
                                className={styles.noteTextarea}
                                value={noteEn}
                                onChange={(e) => onNoteEnChange?.(e.target.value)}
                                placeholder="Notes in English (optional)…"
                                rows={10}
                                style={{
                                  width: '100%',
                                  resize: 'vertical',
                                  padding: 10,
                                  borderRadius: 6,
                                  border: '1px solid #d9d9d9',
                                }}
                              />
                            ),
                          },
                        ]}
                      />
                      <Button type="primary" style={{ marginTop: 12 }} onClick={onSaveNotes}>
                        保存补充说明
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className={styles.editHint}>
                  由 Markdown 自动转换而来，可在下方调整标题层级、<strong>字体颜色</strong>、背景色、列表与对齐方式；导出为<strong>新的</strong>
                  Word 文件，不会覆盖输出目录中的原始 .md。
                </div>
                <Space wrap style={{ marginBottom: 12 }}>
                  <Button type="primary" onClick={handleExportCurrent}>
                    导出当前语言为 Word
                  </Button>
                  <Button onClick={handleExportCombined}>导出中英合一 Word</Button>
                  <Button onClick={reloadFromMarkdown}>从 Markdown 重新载入</Button>
                </Space>
                <Tabs
                  size="small"
                  activeKey={activeEditLang}
                  onChange={(k) => setActiveEditLang(k as 'zh' | 'en')}
                  items={editTabs}
                />
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
