import {
  IconBot,
  IconBook,
  IconCatalog,
  IconPhone
} from './Icons';
import { Accordion, AccordionItem } from './Accordion';

const STEPS = [
  {
    n: 1,
    text: 'Подключите WhatsApp (раздел «Сессия») — отсканируйте QR, если бот ещё не авторизован.'
  },
  {
    n: 2,
    text: 'Проверьте каталог объектов — бот предлагает объявления с сайта в переписке.'
  },
  {
    n: 3,
    text: 'Настройте умного помощника и базу знаний — так задаётся характер и факты бота.'
  },
  {
    n: 4,
    text: 'После каждого сохранения изменения действуют сразу — перезапуск не нужен.'
  }
];

const SECTIONS_GUIDE = [
  {
    id: 'session',
    title: 'Сессия WhatsApp',
    Icon: IconPhone,
    what: 'Подключение номера WhatsApp к боту: статус сессии, QR-код для входа, данные подключённого аккаунта.',
    edit: [
      'Сканировать QR-код, если сессия не активна',
      'Проверить, что отображается «Сессия активна» и имя/телефон аккаунта'
    ],
    effect:
      'Без активной сессии бот не получает и не отправляет сообщения в WhatsApp. Это техническая основа — сначала убедитесь, что здесь всё в порядке.',
    tip: 'QR обновляется автоматически. Если сессия слетела — отсканируйте заново с телефона: WhatsApp → Связанные устройства.'
  },
  {
    id: 'catalog',
    title: 'Каталог объектов',
    Icon: IconCatalog,
    what: 'Просмотр всех объектов, спарсенных с housetenerife.eu (600+ объявлений): поиск, цены, ссылки на сайт.',
    edit: [
      'Искать объекты по названию, району, типу, цене',
      'Проверять, что каталог не пуст и дата синхронизации актуальна',
      'Открывать карточку на сайте по ссылке'
    ],
    effect:
      'Бот подбирает объекты из этого каталога и отправляет клиентам ссылки и описания. Если каталог пуст — бот не сможет показать конкретные объявления, только общие ответы.',
    tip: 'Обновление каталога на сервере: команда npm run sync-db (делает IT/администратор). После синхронизации перезапустите бота.'
  },
  {
    id: 'assistant',
    title: 'Умный помощник',
    Icon: IconBot,
    what: 'Настройка «личности» бота: основная инструкция, дополнительные правила и пошаговый путь диалога с клиентом.',
    edit: [
      'Основная инструкция — кто бот, цели, тон общения',
      'Дополнительные условия — стиль, запреты, формат сообщений в WhatsApp',
      'Путь диалога — шаги: приветствие → тип недвижимости → бюджет → локация → подборка объектов'
    ],
    effect:
      'Эти тексты попадают в каждый ответ ИИ. Меняете приветствие или порядок вопросов — бот ведёт диалог по-новому уже в следующем сообщении клиента.',
    tip: 'Один главный вопрос за сообщение — не перегружайте шаги. Сохраняйте кнопкой «Сохранить изменения».'
  },
  {
    id: 'knowledge',
    title: 'База знаний',
    Icon: IconBook,
    what: 'Факты о компании House Tenerife: услуги, контакты, налоги, визы, playbook, статьи для бота.',
    edit: [
      'Статьи — добавляйте FAQ и важные формулировки',
      'Основное — бренд, дисклеймер, плюсы/минусы, официальные источники',
      'Темы и контакты — NIE, визы, телефоны, email',
      'Полный JSON — для сложных блоков (playbook, featured properties)'
    ],
    effect:
      'Бот обязан опираться на базу знаний: не выдумывает цены, контакты и юридические факты. Что не в базе — честно говорит, что уточнит у менеджера.',
    tip: 'Приоритет у бота: база знаний → каталог с сайта → общие рассуждения. Сначала актуализируйте контакты и услуги.'
  }
];

export default function GuideSection({ onNavigate }) {
  return (
    <div className="guide">
      <div className="card card--info guide-intro">
        <h3 className="card__title">Инструкция для менеджера</h3>
        <p className="card__desc">
          Эта панель управляет WhatsApp-ботом House Tenerife. Ниже — что можно менять, зачем это
          нужно и как влияет на ответы клиентам. Нажимайте «Перейти в раздел», чтобы сразу открыть
          нужные настройки.
        </p>
      </div>

      <div className="card guide-quick">
        <h3 className="card__title">Быстрый старт</h3>
        <ol className="guide-steps">
          {STEPS.map((s) => (
            <li key={s.n} className="guide-steps__item">
              <span className="guide-steps__num">{s.n}</span>
              <span>{s.text}</span>
            </li>
          ))}
        </ol>
      </div>

      <Accordion className="guide-accordion">
        {SECTIONS_GUIDE.map((item) => (
          <AccordionItem
            key={item.id}
            title={item.title}
            subtitle="Что редактировать и как влияет на бота"
          >
            <article className="guide-card guide-card--nested">
              <div className="guide-card__block">
                <h4 className="guide-card__label">Что это</h4>
                <p>{item.what}</p>
              </div>

              <div className="guide-card__block">
                <h4 className="guide-card__label">Что можно редактировать</h4>
                <ul>
                  {item.edit.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>

              <div className="guide-card__block guide-card__block--accent">
                <h4 className="guide-card__label">Влияние на бота</h4>
                <p>{item.effect}</p>
              </div>

              <p className="guide-card__tip">
                <strong>Совет:</strong> {item.tip}
              </p>

              <button
                type="button"
                className="btn btn--primary btn--full"
                onClick={() => onNavigate(item.id)}
              >
                Перейти в раздел →
              </button>
            </article>
          </AccordionItem>
        ))}
      </Accordion>

      <div className="card guide-footer">
        <p className="card__desc">
          Код входа в панель знает только администратор. Статус «Бот онлайн» вверху справа показывает,
          что WhatsApp подключён и бот готов отвечать.
        </p>
      </div>
    </div>
  );
}
