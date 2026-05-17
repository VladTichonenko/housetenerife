import { IconPlus, IconTrash } from './Icons';

export default function KnowledgeArticlesTab({ articles, onChange }) {
  const update = (index, field, value) => {
    onChange(articles.map((a, i) => (i === index ? { ...a, [field]: value } : a)));
  };

  const add = () => {
    onChange([
      ...articles,
      { id: `article-${Date.now()}`, title: '', category: '', content: '' }
    ]);
  };

  const remove = (index) => {
    onChange(articles.filter((_, i) => i !== index));
  };

  return (
    <div className="card">
      <div className="card__header card__header--row">
        <div>
          <h3 className="card__title">Статьи базы знаний</h3>
          <p className="card__desc">Добавляйте факты, FAQ и инструкции — бот использует их в ответах</p>
        </div>
        <button type="button" className="btn btn--outline btn--sm" onClick={add}>
          <IconPlus /> Новая статья
        </button>
      </div>
      {articles.length === 0 ? (
        <p className="kb-empty">Статей пока нет. Нажмите «Новая статья».</p>
      ) : (
        <div className="kb-articles">
          {articles.map((article, index) => (
            <div key={article.id || index} className="kb-article">
              <div className="kb-article__head">
                <span className="kb-article__num">#{index + 1}</span>
                <button
                  type="button"
                  className="path-step__remove"
                  onClick={() => remove(index)}
                  aria-label="Удалить статью"
                >
                  <IconTrash />
                </button>
              </div>
              <input
                className="input"
                placeholder="Заголовок"
                value={article.title || ''}
                onChange={(e) => update(index, 'title', e.target.value)}
              />
              <input
                className="input"
                placeholder="Категория (например: налоги, визы)"
                value={article.category || ''}
                onChange={(e) => update(index, 'category', e.target.value)}
              />
              <textarea
                className="textarea"
                rows={5}
                placeholder="Содержание статьи"
                value={article.content || ''}
                onChange={(e) => update(index, 'content', e.target.value)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
