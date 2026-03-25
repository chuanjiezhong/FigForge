import ReactQuill from 'react-quill'
import 'quill/dist/quill.snow.css'
import styles from './index.module.less'

const modules = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ color: [] }, { background: [] }],
    [{ list: 'ordered' }, { list: 'bullet' }],
    [{ align: [] }],
    ['clean'],
  ],
}

const formats = [
  'header',
  'bold',
  'italic',
  'underline',
  'strike',
  'color',
  'background',
  'list',
  'bullet',
  'align',
]

type Props = {
  value: string
  onChange: (html: string) => void
  placeholder?: string
}

/**
 * 富文本编辑（Quill），用于排版后导出 Word。
 */
export default function RichEditorPane({ value, onChange, placeholder }: Props) {
  return (
    <div className={styles.quillWrap}>
      <ReactQuill
        theme="snow"
        value={value}
        onChange={onChange}
        modules={modules}
        formats={formats}
        placeholder={placeholder}
      />
    </div>
  )
}
