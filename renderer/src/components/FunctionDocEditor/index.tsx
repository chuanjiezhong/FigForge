import { useState, useEffect } from 'react'
import {
  Modal,
  Button,
  Space,
  message,
  Typography,
  Table,
  Popconfirm,
} from 'antd'
import styles from './index.module.less'

const { Title } = Typography

interface FunctionDocEditorProps {
  open: boolean
  onClose: () => void
  functionName?: string
  packageName?: string
}

interface FunctionDocData {
  name: string
  package?: string
  description?: string
  documentation?: string
  examples?: string
  detailedParameters?: Array<{ name: string }>
  version?: string
  author?: string
}

function FunctionDocEditor({ open, onClose }: FunctionDocEditorProps) {
  const [existingDocs, setExistingDocs] = useState<FunctionDocData[]>([])

  useEffect(() => {
    if (open) {
      loadExistingDocs()
    }
  }, [open])

  const loadExistingDocs = async () => {
    try {
      const result = await window.electronAPI.getAllFunctionDocs()
      if (result.success && result.docs) {
        setExistingDocs(result.docs as FunctionDocData[])
      }
    } catch (error) {
      console.error('Failed to load existing docs:', error)
    }
  }

  const handleImportJson = async () => {
    try {
      const files = await window.electronAPI.selectFiles({
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
        properties: ['openFile'],
      })
      if (!files || files.length === 0) return

      const filePath = files[0]
      const readRes = await window.electronAPI.readFile(filePath)
      if (!readRes.success || !readRes.content) {
        message.error(readRes.error || '读取 JSON 失败')
        return
      }

      const parsed = JSON.parse(readRes.content) as any

      let items: FunctionDocData[] = []
      if (parsed?.packages && Array.isArray(parsed.packages)) {
        for (const p of parsed.packages || []) {
          for (const f of p.functions || []) {
            if (!f?.name) continue
            items.push({ ...f, package: p.package })
          }
        }
      } else if (parsed?.titles && Array.isArray(parsed.titles)) {
        for (const t of parsed.titles) {
          for (const p of t.packages || []) {
            for (const f of p.functions || []) {
              if (!f?.name) continue
              items.push({ ...f, package: p.package })
            }
          }
        }
      } else if (parsed?.functions && Array.isArray(parsed.functions)) {
        items = parsed.functions as FunctionDocData[]
      } else {
        message.error('JSON 格式不正确：需要 packages / titles / functions')
        return
      }

      let ok = 0
      for (const f of items) {
        if (!f?.name) continue
        const res = await window.electronAPI.saveFunctionDoc(f)
        if (res.success) ok += 1
      }

      message.success(`导入完成：成功写入 ${ok} 条函数文档`)
      await loadExistingDocs()
    } catch (error) {
      console.error('Failed to import json:', error)
      message.error('导入失败：JSON 解析或写入出错')
    }
  }

  const handleExportJson = async () => {
    try {
      const cfgRes = await window.electronAPI.getFunctionDocConfig()
      if (!cfgRes.success || !cfgRes.config) {
        message.error(cfgRes.error || '获取配置失败')
        return
      }

      const savePath = await window.electronAPI.selectSavePath({
        defaultPath: 'function-docs.json',
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
      })
      if (!savePath) return

      const data = JSON.stringify(cfgRes.config, null, 2)
      const writeRes = await window.electronAPI.writeFile(savePath, data)
      if (!writeRes.success) {
        message.error(writeRes.error || '导出失败')
        return
      }
      message.success('导出成功')
    } catch (error) {
      console.error('Failed to export json:', error)
      message.error('导出失败')
    }
  }

  const handleDelete = async (name: string, pkg?: string) => {
    try {
      await window.electronAPI.deleteFunctionDoc(name, pkg)
      message.success('删除成功')
      loadExistingDocs()
    } catch (error) {
      console.error('Failed to delete function doc:', error)
      message.error('删除失败')
    }
  }

  return (
    <Modal
      title={<span>函数文档管理</span>}
      open={open}
      onCancel={onClose}
      footer={
        <Button type="primary" onClick={onClose}>
          关闭
        </Button>
      }
      width={800}
      style={{ top: 20 }}
    >
      <div className={styles.functionDocEditor}>
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Space>
              <Button onClick={handleImportJson}>导入 JSON</Button>
              <Button onClick={handleExportJson}>导出 JSON</Button>
            </Space>
          </div>

          <div>
            <Title level={5}>现有函数文档</Title>
            <Table
              dataSource={existingDocs}
              columns={[
                {
                  title: '函数名',
                  dataIndex: 'name',
                  key: 'name',
                },
                {
                  title: '包名',
                  dataIndex: 'package',
                  key: 'package',
                },
                {
                  title: '描述',
                  dataIndex: 'description',
                  key: 'description',
                  ellipsis: true,
                },
                {
                  title: '操作',
                  key: 'action',
                  render: (_: unknown, record: FunctionDocData) => (
                    <Popconfirm
                      title="确定删除这个函数文档吗？"
                      onConfirm={() => handleDelete(record.name, record.package)}
                    >
                      <Button type="link" size="small" danger>
                        删除
                      </Button>
                    </Popconfirm>
                  ),
                },
              ]}
              rowKey={(record) => `${record.name}-${record.package || ''}`}
              pagination={{ pageSize: 5 }}
              size="small"
            />
          </div>
        </Space>
      </div>
    </Modal>
  )
}

export default FunctionDocEditor
