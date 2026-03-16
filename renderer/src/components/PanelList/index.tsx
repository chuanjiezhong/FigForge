import { List, Empty } from 'antd'
import styles from './index.module.less'

function PanelList() {
  // TODO: 从状态管理获取 panel 列表
  const panels: unknown[] = []

  return (
    <div className={styles.panelList}>
      <h3 className={styles.title}>Panel 列表</h3>
      {panels.length === 0 ? (
        <div className={styles.empty}>
          <Empty description="暂无 Panel" />
        </div>
      ) : (
        <List
          className={styles.list}
          dataSource={panels}
          renderItem={(item) => (
            <List.Item>
              {/* TODO: 实现 Panel 列表项 */}
              {JSON.stringify(item)}
            </List.Item>
          )}
        />
      )}
    </div>
  )
}

export default PanelList

