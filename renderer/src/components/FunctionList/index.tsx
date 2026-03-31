import { useState, useEffect } from 'react'
import { List, Empty, Button, message, Collapse, Typography, Select, Input, Space } from 'antd'
import { PlayCircleOutlined, CloudDownloadOutlined } from '@ant-design/icons'
import styles from './index.module.less'
import type { RFunctionInfo } from '../../types/pipeline'

const { Text } = Typography

interface FunctionListProps {
  onSelectFunction?: (func: RFunctionInfo | null) => void
}

/** 从 owner/repo 取展示名（最后一段） */
function repoDisplayName(repo: string): string {
  const part = repo.split('/').pop()
  return part || repo
}

function FunctionList({ onSelectFunction }: FunctionListProps) {
  const [functions, setFunctions] = useState<RFunctionInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [githubPackages, setGithubPackages] = useState<string[]>([])
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null)
  const [updatingRepo, setUpdatingRepo] = useState<string | null>(null)
  const [githubToken, setGithubToken] = useState<string>('')
  const [hasSavedToken, setHasSavedToken] = useState<boolean>(false)

  // 加载函数列表
  const loadFunctions = async () => {
    setLoading(true)
    try {
      if (typeof window.electronAPI.getAllFunctionDocs !== 'function') {
        message.error('函数文档 API 未加载：请重启应用（preload 变更需要重启）')
        setFunctions([])
        return
      }
      const result = await window.electronAPI.getAllFunctionDocs()
      if (!result.success || !result.docs) {
        message.error(result.error || '加载函数列表失败')
        setFunctions([])
        return
      }

      const docs = result.docs as Array<{
        name: string
        package?: string
        category?: string
        description?: string
        detailedParameters?: Array<{ name: string }>
      }>

      const CATEGORY_ORDER: string[] = ['transcriptomics', 'metabolomics', 'single_cell', 'proteomics']

      const mapped: RFunctionInfo[] = docs
        .map((d) => ({
          name: d.name,
          package: d.package,
          category: d.category,
          description: d.description,
          parameters: Array.isArray(d.detailedParameters)
            ? d.detailedParameters.map((p) => p.name).filter(Boolean)
            : [],
        }))
        .sort((a, b) => {
          const ac = a.category || ''
          const bc = b.category || ''
          const ai = CATEGORY_ORDER.indexOf(ac)
          const bi = CATEGORY_ORDER.indexOf(bc)
          if (ai !== bi) return (ai >= 0 ? ai : 999) - (bi >= 0 ? bi : 999)
          const ap = a.package || ''
          const bp = b.package || ''
          if (ap !== bp) return ap.localeCompare(bp)
          return a.name.localeCompare(b.name)
        })

      setFunctions(mapped)
    } catch (error) {
      const errMsg =
        error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'
      message.error(`加载函数列表时出错：${errMsg}`)
      console.error(error)
      setFunctions([])
    } finally {
      setLoading(false)
    }
  }

  const loadGithubPackages = async () => {
    if (typeof window.electronAPI.getRPackageUpdateList !== 'function') return
    const res = await window.electronAPI.getRPackageUpdateList()
    if (res.success && Array.isArray(res.packages)) {
      setGithubPackages(res.packages)
      if (res.packages.length > 0 && !selectedRepo) setSelectedRepo(res.packages[0])
    }
  }

  useEffect(() => {
    loadFunctions()
    loadGithubPackages()
    void (async () => {
      if (typeof window.electronAPI.getGitHubToken !== 'function') return
      const res = await window.electronAPI.getGitHubToken()
      if (res.success) {
        setHasSavedToken(Boolean(res.token && res.token.trim()))
      }
    })()
  }, [])

  const handleUpdatePackage = async () => {
    const repo = selectedRepo
    if (!repo) {
      message.warning('请先选择要更新的 R 包')
      return
    }
    if (typeof window.electronAPI.installRPackageFromGitHub !== 'function') {
      message.error('当前环境不支持从 GitHub 更新 R 包')
      return
    }
    setUpdatingRepo(repo)
    try {
      if (typeof window.electronAPI.setGitHubToken === 'function') {
        // 若用户输入了 token，则保存到本机（不回显），后续更新无需重复输入
        if (githubToken.trim()) {
          const saved = await window.electronAPI.setGitHubToken(githubToken.trim())
          if (!saved.success) {
            message.error(saved.error || '保存 GitHub Token 失败')
            return
          }
          setGithubToken('')
          setHasSavedToken(true)
        }
      }
      const result = await window.electronAPI.installRPackageFromGitHub(repo)
      if (result.success) {
        message.success(`${repoDisplayName(repo)} 更新成功`)
        loadFunctions()
      } else {
        message.error(result.error || '更新失败')
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '更新失败')
    } finally {
      setUpdatingRepo(null)
    }
  }

  // 点击函数
  const handleFunctionClick = (func: RFunctionInfo) => {
    // 通知父组件显示函数详情
    if (onSelectFunction) {
      onSelectFunction(func)
    }
  }

  return (
    <div className={styles.functionList}>
      <div className={styles.header}>
        <h3 className={styles.title}>函数列表</h3>
        <Button 
          size="small" 
          onClick={() => loadFunctions()} 
          loading={loading}
        >
          刷新
        </Button>
      </div>

      {githubPackages.length > 0 && (
        <div className={styles.packageUpdate}>
          <div className={styles.packageUpdateTitle}>
            <CloudDownloadOutlined /> R 包更新
          </div>
          <div className={styles.packageUpdateRow}>
            <Select
              className={styles.packageUpdateSelect}
              size="small"
              placeholder="选择 R 包"
              value={selectedRepo}
              onChange={setSelectedRepo}
              options={githubPackages.map((repo) => ({
                label: repoDisplayName(repo),
                value: repo,
                title: repo,
              }))}
              dropdownMatchSelectWidth={false}
            />
            <Button
              type="primary"
              size="small"
              loading={!!updatingRepo}
              onClick={handleUpdatePackage}
            >
              更新
            </Button>
          </div>
          <div style={{ marginTop: 8 }}>
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              <Input.Password
                size="small"
                placeholder={hasSavedToken ? '已保存 Token（可留空直接更新）' : '可选：填入 GitHub Token（私有仓库需要）'}
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ color: '#888', fontSize: 12 }}>
                  Token 仅保存在本机，用于 remotes 拉取私有仓库。
                </span>
                <Button
                  size="small"
                  onClick={async () => {
                    if (typeof window.electronAPI.setGitHubToken !== 'function') return
                    const res = await window.electronAPI.setGitHubToken('')
                    if (res.success) {
                      setHasSavedToken(false)
                      setGithubToken('')
                      message.success('已清除 Token')
                    } else {
                      message.error(res.error || '清除失败')
                    }
                  }}
                >
                  清除 Token
                </Button>
              </div>
            </Space>
          </div>
        </div>
      )}

      {functions.length === 0 ? (
        <div className={styles.empty}>
          <Empty description="暂无函数" />
        </div>
      ) : (
        <div className={styles.list}>
          <Collapse
            accordion={false}
            bordered={false}
            items={(() => {
              const CATEGORY_ORDER = ['transcriptomics', 'metabolomics', 'single_cell', 'proteomics']
              const CATEGORY_LABELS: Record<string, string> = {
                transcriptomics: '转录组学',
                metabolomics: '代谢组学',
                single_cell: '单细胞',
                proteomics: '蛋白组学',
                other: '未分类',
              }
              const byCategory = functions.reduce<Record<string, RFunctionInfo[]>>((acc, f) => {
                const cat = f.category || 'other'
                acc[cat] = acc[cat] || []
                acc[cat].push(f)
                return acc
              }, {})
              const ordered = CATEGORY_ORDER.concat(
                Object.keys(byCategory).filter((k) => !CATEGORY_ORDER.includes(k))
              )
              return ordered.map((groupKey) => {
                const funcs = byCategory[groupKey] || []
                const displayName = CATEGORY_LABELS[groupKey] ?? groupKey
                return {
                  key: groupKey,
                  label: (
                    <div className={styles.packageHeader}>
                      <span className={styles.packageName}>{displayName}</span>
                      <Text type="secondary" className={styles.packageCount}>
                        {funcs.length}
                      </Text>
                    </div>
                  ),
                  children: (
                    <List
                      dataSource={funcs.sort((a, b) => a.name.localeCompare(b.name))}
                      renderItem={(func) => {
                      const params = Array.isArray(func.parameters) ? func.parameters : []
                      const preview = params.slice(0, 6).join(', ')
                      const more = params.length > 6 ? ` …(+${params.length - 6})` : ''
                      return (
                        <List.Item
                          className={styles.listItem}
                          onClick={() => handleFunctionClick(func)}
                          style={{ cursor: 'pointer' }}
                        >
                          <List.Item.Meta
                            title={
                              <div className={styles.functionName}>
                                <PlayCircleOutlined className={styles.icon} />
                                <span>{func.name}</span>
                              </div>
                            }
                            description={
                              <div>
                                {func.description && <div>{func.description}</div>}
                                {params.length > 0 && (
                                  <div className={styles.parameters}>
                                    参数: {preview}
                                    {more}
                                  </div>
                                )}
                              </div>
                            }
                          />
                        </List.Item>
                      )
                    }}
                    />
                  ),
                }
              })
            })()}
          />
        </div>
      )}
    </div>
  )
}

export default FunctionList

