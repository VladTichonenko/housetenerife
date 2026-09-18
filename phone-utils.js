const { parsePhoneNumber } = require('libphonenumber-js');

// Маппинг кодов стран на языки
const countryToLanguage = {
  'RU': 'ru', // Россия - русский
  'KZ': 'ru', // Казахстан - русский
  'BY': 'ru', // Беларусь - русский
  'UA': 'uk', // Украина - украинский
  'ES': 'es', // Испания - испанский
  'MX': 'es', // Мексика - испанский
  'AR': 'es', // Аргентина - испанский
  'CO': 'es', // Колумбия - испанский
  'PE': 'es', // Перу - испанский
  'CL': 'es', // Чили - испанский
  'US': 'en', // США - английский
  'GB': 'en', // Великобритания - английский
  'CA': 'en', // Канада - английский
  'AU': 'en', // Австралия - английский
  'DE': 'de', // Германия - немецкий
  'AT': 'de', // Австрия - немецкий
  'CH': 'de', // Швейцария - немецкий
  'FR': 'fr', // Франция - французский
  'BE': 'fr', // Бельгия - французский
  'IT': 'it', // Италия - итальянский
  'PT': 'pt', // Португалия - португальский
  'BR': 'pt', // Бразилия - португальский
  'PL': 'pl', // Польша - польский
  'NL': 'nl', // Нидерланды - нидерландский
  'SR': 'nl', // Суринам - нидерландский
  'TR': 'tr', // Турция - турецкий
  'CN': 'zh', // Китай - китайский
  'JP': 'ja', // Япония - японский
  'KR': 'ko', // Южная Корея - корейский
  'IN': 'hi', // Индия - хинди
  'SA': 'ar', // Саудовская Аравия - арабский
  'AE': 'ar', // ОАЭ - арабский
  // Добавьте больше стран по необходимости
};

// Языковые тексты для бота
const translations = {
  ru: {
    start:
      'Привет! Я *Максим*, инвестиционный аналитик House Tenerife — помогу с недвижимостью и инвестпроектами (Тенерифе, Дубай, Ибица, Марбелья, Малага, Барселона и др., каталог housetenerife.eu).\n\nДля начала подскажите: рассматриваете покупку *для жизни* или *для инвестиции*? Или /help для команд.',
    help: `Доступные команды:
/start - Начать работу с ботом
/help - Показать справку
/status - Проверить состояние бота
/time - Текущее время
/site - Перейти на сайт House Tenerife
/ping - Проверить, видит ли бот вас

Я консультирую как инвестиционный аналитик House Tenerife: Тенерифе, Дубай, Ибица, Марбелья и др. Просто напишите вопрос.`,
    status: 'Бот работает! Статус: готов к работе',
    time: 'Текущее время:',
    site: 'Каталог House Tenerife — объекты и подробности на сайте:',
    echo: 'Вы написали:',
    useHelp: 'Используйте /help для списка команд.',
    error: 'Произошла ошибка при обработке сообщения. Попробуйте еще раз.',
    ciphertext_reply: 'Сообщение получено, но это зашифрованное или одноразовое сообщение — я не вижу текст. Напишите, пожалуйста, обычным текстом.',
    voice_reply:
      'Я не могу прослушивать голосовые сообщения.\n\nНапишите, пожалуйста, *текстом* — или скажите, если хотите созвон с {manager_name}, он поможет с вашим запросом.',
    manager_handoff:
      'Отлично{client_name_part}! Я передал вашу заявку — *{manager_name}* свяжется с вами в WhatsApp в ближайшее время.\n\nЕсли удобнее написать первым: {manager_phone}\n\nПока ждёте — могу уточнить подборку или ответить на вопросы здесь.',
    manager_handoff_image:
      'Отлично{client_name_part}! Я передал вашу заявку — *{manager_name}* свяжется с вами в WhatsApp в ближайшее время.\n\nЕсли удобнее написать первым: {manager_phone}',
    manager_handoff_link:
      'Отлично{client_name_part}! Я передал вашу заявку — *{manager_name}* свяжется с вами в WhatsApp в ближайшее время.\n\nЕсли удобнее написать первым: {manager_phone}',
    handoff_ask_name:
      'Хорошо, давайте созвонимся и обсудим детали.\n\nПодскажите, пожалуйста, *как к вам обращаться?*',
    handoff_name_invalid:
      'Пожалуйста, напишите, как к вам обращаться (имя или как вас называть).'
  },
  es: {
    start:
      '¡Hola! Soy *Maksim*, analista de inversiones de House Tenerife — te ayudo con inmuebles y proyectos de inversión (Tenerife, Dubái, Ibiza, Marbella, Málaga, Barcelona y más, catálogo housetenerife.eu).\n\nPara empezar: ¿buscas *para vivir* o *para invertir*? O escribe /help para comandos.',
    help: `Comandos disponibles:
/start - Comenzar a trabajar con el bot
/help - Mostrar ayuda
/status - Verificar el estado del bot
/time - Hora actual
/site - Catálogo housetenerife.eu
/ping - Comprobar si el bot te ve

¡Simplemente escríbeme cualquier mensaje y responderé!`,
    status: '¡El bot está funcionando! Estado: listo para trabajar',
    time: 'Hora actual:',
    site: 'Catálogo House Tenerife (Tenerife, España):',
    echo: 'Escribiste:',
    useHelp: 'Usa /help para ver la lista de comandos.',
    error: 'Ocurrió un error al procesar el mensaje. Inténtalo de nuevo.',
    ciphertext_reply:
      'Mensaje recibido, pero no puedo leer el texto (cifrado o de un solo uso). Escribe, por favor, un mensaje de texto normal.',
    voice_reply:
      'No puedo escuchar mensajes de voz.\n\nEscríbeme por *texto* — o dime si quieres una llamada con {manager_name} para hablar de tu consulta.',
    manager_handoff:
      'Perfecto{client_name_part}! He pasado tu solicitud — *{manager_name}* te escribirá por WhatsApp en breve.\n\nO puedes escribirle primero: {manager_phone}\n\nMientras tanto, puedo afinar la selección o responder dudas aquí.',
    manager_handoff_image:
      'Perfecto{client_name_part}! He pasado tu solicitud — *{manager_name}* te escribirá por WhatsApp en breve.\n\nO puedes escribirle primero: {manager_phone}',
    manager_handoff_link:
      'Perfecto{client_name_part}! He pasado tu solicitud — *{manager_name}* te escribirá por WhatsApp en breve.\n\nO puedes escribirle primero: {manager_phone}',
    handoff_ask_name:
      'Perfecto, organicemos una llamada breve para ver los detalles.\n\n*¿Cómo debemos llamarte?*',
    handoff_name_invalid:
      'Por favor, escribe cómo debemos llamarte (tu nombre).'
  },
  en: {
    start:
      'Hi! I\'m *Maxim*, investment analyst at House Tenerife — I help with property and investment projects (Tenerife, Dubai, Ibiza, Marbella, Málaga, Barcelona and more, catalog at housetenerife.eu).\n\nTo start: are you looking *to live* or *to invest*? Or type /help for commands.',
    help: `Available commands:
/start - Start working with the bot
/help - Show help
/status - Check bot status
/time - Current time
/site - housetenerife.eu catalog
/ping - Check if the bot sees you

Just write me any message and I will reply!`,
    status: 'Bot is working! Status: ready to work',
    time: 'Current time:',
    site: 'House Tenerife catalog and details:',
    echo: 'You wrote:',
    useHelp: 'Use /help for a list of commands.',
    error: 'An error occurred while processing the message. Please try again.',
    ciphertext_reply: 'I received your message but it\'s encrypted or view-once — I can\'t read the text. Please send a regular text message.',
    voice_reply:
      'I can\'t listen to voice messages.\n\nPlease send *text* — or say if you\'d like a call with {manager_name} to discuss your request.',
    manager_handoff:
      'Perfect{client_name_part}! I\'ve passed your request — *{manager_name}* will reach out on WhatsApp shortly.\n\nOr message them first: {manager_phone}\n\nWhile you wait — I can refine the shortlist or answer questions here.',
    manager_handoff_image:
      'Perfect{client_name_part}! I\'ve passed your request — *{manager_name}* will reach out on WhatsApp shortly.\n\nOr message them first: {manager_phone}',
    manager_handoff_link:
      'Perfect{client_name_part}! I\'ve passed your request — *{manager_name}* will reach out on WhatsApp shortly.\n\nOr message them first: {manager_phone}',
    handoff_ask_name:
      'Great — let\'s arrange a quick call to go through the details.\n\n*How should we address you?*',
    handoff_name_invalid:
      'Please tell us how to address you (your name).'
  },
  de: {
    start:
      'Hallo! Ich bin *Maxim*, Investment-Analyst bei House Tenerife — ich helfe bei Immobilien und Investmentprojekten (Teneriffa, Dubai, Ibiza, Marbella, Málaga, Barcelona und mehr, Katalog housetenerife.eu).\n\nZum Start: suchen Sie *zum Wohnen* oder *als Investment*? Oder /help für Befehle.',
    help: `Verfügbare Befehle:
/start - Gespräch starten
/help - Hilfe anzeigen
/status - Bot-Status prüfen
/time - Aktuelle Zeit
/site - Katalog housetenerife.eu
/ping - Prüfen, ob der Bot Sie sieht

Schreiben Sie einfach, wonach Sie suchen — ich antworte auf Deutsch.`,
    status: 'Bot funktioniert! Status: bereit',
    time: 'Aktuelle Zeit:',
    site: 'House Tenerife — Immobilienkatalog:',
    echo: 'Sie haben geschrieben:',
    useHelp: 'Verwenden Sie /help für die Liste der Befehle.',
    error: 'Beim Verarbeiten der Nachricht ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.',
    ciphertext_reply:
      'Nachricht erhalten, aber ich kann den Text nicht lesen (verschlüsselt oder einmalig). Bitte als normalen Text senden.',
    voice_reply:
      'Ich kann Sprachnachrichten nicht anhören.\n\nBitte schreiben Sie *Text* — oder sagen Sie, ob Sie einen Anruf mit {manager_name} möchten.',
    manager_handoff:
      'Perfekt{client_name_part}! Ich habe Ihre Anfrage weitergegeben — *{manager_name}* schreibt Ihnen in Kürze auf WhatsApp.\n\nOder schreiben Sie zuerst selbst: {manager_phone}\n\nSolange Sie warten, kann ich die Auswahl hier verfeinern oder Fragen beantworten.',
    manager_handoff_image:
      'Perfekt{client_name_part}! Ich habe Ihre Anfrage weitergegeben — *{manager_name}* schreibt Ihnen in Kürze auf WhatsApp.\n\nOder schreiben Sie zuerst selbst: {manager_phone}',
    manager_handoff_link:
      'Perfekt{client_name_part}! Ich habe Ihre Anfrage weitergegeben — *{manager_name}* schreibt Ihnen in Kürze auf WhatsApp.\n\nOder schreiben Sie zuerst selbst: {manager_phone}',
    handoff_ask_name:
      'Gerne — lassen Sie uns einen kurzen Anruf vereinbaren.\n\n*Wie dürfen wir Sie ansprechen?*',
    handoff_name_invalid:
      'Bitte sagen Sie uns, wie wir Sie ansprechen sollen (Ihr Name).'
  },
  fr: {
    start:
      'Bonjour ! Je suis *Maxim*, analyste d’investissement chez House Tenerife — j’aide pour l’immobilier et les projets d’investissement (Ténérife, Dubaï, Ibiza, Marbella, Málaga, Barcelone et plus, catalogue housetenerife.eu).\n\nPour commencer : vous cherchez *pour habiter* ou *pour investir* ? Ou /help pour les commandes.',
    help: `Commandes disponibles :
/start - Démarrer la conversation
/help - Afficher l’aide
/status - État du bot
/time - Heure actuelle
/site - Catalogue housetenerife.eu
/ping - Vérifier si le bot vous voit

Écrivez-moi simplement — je répondrai en français.`,
    status: 'Le bot fonctionne ! Statut : prêt',
    time: 'Heure actuelle :',
    site: 'House Tenerife — catalogue immobilier :',
    echo: 'Vous avez écrit :',
    useHelp: 'Utilisez /help pour la liste des commandes.',
    error: 'Une erreur s’est produite lors du traitement du message. Veuillez réessayer.',
    ciphertext_reply:
      'Message reçu, mais je ne peux pas lire le texte (chiffré ou éphémère). Envoyez un message texte normal.',
    voice_reply:
      'Je ne peux pas écouter les messages vocaux.\n\nÉcrivez en *texte* — ou dites si vous voulez un appel avec {manager_name}.',
    manager_handoff:
      'Parfait{client_name_part} ! J’ai transmis votre demande — *{manager_name}* vous écrira bientôt sur WhatsApp.\n\nOu écrivez-lui en premier : {manager_phone}\n\nEn attendant, je peux affiner la sélection ou répondre ici.',
    manager_handoff_image:
      'Parfait{client_name_part} ! J’ai transmis votre demande — *{manager_name}* vous écrira bientôt sur WhatsApp.\n\nOu écrivez-lui en premier : {manager_phone}',
    manager_handoff_link:
      'Parfait{client_name_part} ! J’ai transmis votre demande — *{manager_name}* vous écrira bientôt sur WhatsApp.\n\nOu écrivez-lui en premier : {manager_phone}',
    handoff_ask_name:
      'Avec plaisir — organisons un court appel.\n\n*Comment devons-nous vous appeler ?*',
    handoff_name_invalid:
      'Indiquez-nous comment vous appeler (votre prénom).'
  },
  it: {
    start:
      'Ciao! Sono *Maxim*, analista di investimenti di House Tenerife — ti aiuto con immobili e progetti di investimento (Tenerife, Dubai, Ibiza, Marbella, Málaga, Barcellona e altro, catalogo housetenerife.eu).\n\nPer iniziare: cerchi *per viverci* o *per investire*? Oppure /help per i comandi.',
    help: `Comandi disponibili:
/start - Inizia la conversazione
/help - Mostra aiuto
/status - Stato del bot
/time - Ora attuale
/site - Catalogo housetenerife.eu
/ping - Controlla se il bot ti vede

Scrivimi pure — rispondo in italiano.`,
    status: 'Il bot funziona! Stato: pronto',
    time: 'Ora attuale:',
    site: 'Catalogo House Tenerife:',
    echo: 'Hai scritto:',
    useHelp: 'Usa /help per l’elenco dei comandi.',
    error: 'Si è verificato un errore durante l’elaborazione del messaggio. Riprova.',
    ciphertext_reply:
      'Messaggio ricevuto, ma non riesco a leggere il testo (cifrato o monouso). Invia un messaggio di testo normale.',
    voice_reply:
      'Non posso ascoltare i messaggi vocali.\n\nScrivi in *testo* — o dimmi se vuoi una chiamata con {manager_name}.',
    manager_handoff:
      'Perfetto{client_name_part}! Ho inoltrato la richiesta — *{manager_name}* ti scriverà su WhatsApp a breve.\n\nOppure scrivigli per primo: {manager_phone}\n\nNel frattempo posso affinare la selezione o rispondere qui.',
    manager_handoff_image:
      'Perfetto{client_name_part}! Ho inoltrato la richiesta — *{manager_name}* ti scriverà su WhatsApp a breve.\n\nOppure scrivigli per primo: {manager_phone}',
    manager_handoff_link:
      'Perfetto{client_name_part}! Ho inoltrato la richiesta — *{manager_name}* ti scriverà su WhatsApp a breve.\n\nOppure scrivigli per primo: {manager_phone}',
    handoff_ask_name:
      'Volentieri — organizziamo una breve chiamata.\n\n*Come dobbiamo chiamarti?*',
    handoff_name_invalid:
      'Scrivi come dobbiamo chiamarti (il tuo nome).'
  },
  pt: {
    start:
      'Olá! Sou o *Maxim*, analista de investimentos da House Tenerife — ajudo com imóveis e projetos de investimento (Tenerife, Dubai, Ibiza, Marbella, Málaga, Barcelona e mais, catálogo housetenerife.eu).\n\nPara começar: procura *para viver* ou *para investir*? Ou /help para os comandos.',
    help: `Comandos disponíveis:
/start - Iniciar a conversa
/help - Mostrar ajuda
/status - Estado do bot
/time - Hora atual
/site - Catálogo housetenerife.eu
/ping - Verificar se o bot o vê

Escreva-me — respondo em português.`,
    status: 'O bot está a funcionar! Estado: pronto',
    time: 'Hora atual:',
    site: 'Catálogo House Tenerife:',
    echo: 'Escreveu:',
    useHelp: 'Use /help para a lista de comandos.',
    error: 'Ocorreu um erro ao processar a mensagem. Tente novamente.',
    ciphertext_reply:
      'Mensagem recebida, mas não consigo ler o texto (encriptada ou de uso único). Envie uma mensagem de texto normal.',
    voice_reply:
      'Não consigo ouvir mensagens de voz.\n\nEscreva em *texto* — ou diga se quer uma chamada com {manager_name}.',
    manager_handoff:
      'Perfeito{client_name_part}! Passei o pedido — *{manager_name}* vai escrever no WhatsApp em breve.\n\nOu escreva primeiro: {manager_phone}\n\nEnquanto espera, posso afinar a seleção ou responder aqui.',
    manager_handoff_image:
      'Perfeito{client_name_part}! Passei o pedido — *{manager_name}* vai escrever no WhatsApp em breve.\n\nOu escreva primeiro: {manager_phone}',
    manager_handoff_link:
      'Perfeito{client_name_part}! Passei o pedido — *{manager_name}* vai escrever no WhatsApp em breve.\n\nOu escreva primeiro: {manager_phone}',
    handoff_ask_name:
      'Com prazer — vamos marcar uma chamada breve.\n\n*Como devemos tratar-lhe?*',
    handoff_name_invalid:
      'Escreva como devemos tratar-lhe (o seu nome).'
  },
  pl: {
    start:
      'Cześć! Jestem *Maxim*, analityk inwestycyjny House Tenerife — pomagam z nieruchomościami i projektami inwestycyjnymi (Teneryfa, Dubaj, Ibiza, Marbella, Málaga, Barcelona i więcej, katalog housetenerife.eu).\n\nNa start: szukacie *do życia* czy *na inwestycję*? Albo wpiszcie /help, by zobaczyć komendy.',
    help: `Dostępne polecenia:
/start - Zacznij pracę z botem
/help - Pokaż pomoc
/status - Sprawdź status bota
/time - Aktualny czas
/site - Katalog housetenerife.eu
/ping - Sprawdź, czy bot Was widzi

Po prostu napiszcie wiadomość — odpowiem po polsku.`,
    status: 'Bot działa! Status: gotowy do pracy',
    time: 'Aktualny czas:',
    site: 'Oficjalna strona House Tenerife z ofertami:',
    echo: 'Napisałeś:',
    useHelp: 'Użyj /help, aby zobaczyć listę poleceń.',
    error: 'Wystąpił błąd podczas przetwarzania wiadomości. Spróbuj ponownie.',
    ciphertext_reply:
      'Wiadomość otrzymana, ale nie mogę odczytać tekstu (szyfrowana/jednorazowa). Proszę napisać zwykłym tekstem.',
    voice_reply:
      'Nie mogę odsłuchać wiadomości głosowych.\n\nNapisz *tekstem* — albo powiedz, czy chcesz rozmowę z {manager_name} o zapytaniu.',
    manager_handoff:
      'Świetnie{client_name_part}! Przekazałem zapytanie — *{manager_name}* napisze na WhatsApp wkrótce.\n\nMożesz też napisać pierwszy: {manager_phone}\n\nTymczasem mogę tu dopracować selekcję lub odpowiedzieć na pytania.',
    manager_handoff_image:
      'Świetnie{client_name_part}! Przekazałem zapytanie — *{manager_name}* napisze na WhatsApp wkrótce.\n\nMożesz też napisać pierwszy: {manager_phone}',
    manager_handoff_link:
      'Świetnie{client_name_part}! Przekazałem zapytanie — *{manager_name}* napisze na WhatsApp wkrótce.\n\nMożesz też napisać pierwszy: {manager_phone}',
    handoff_ask_name:
      'Świetnie, zorganizujmy krótką rozmowę o szczegółach.\n\n*Jak mamy się do Państwa zwracać?*',
    handoff_name_invalid:
      'Proszę napisać, jak mamy się zwracać (imię).'
  },
  nl: {
    start:
      'Hallo! Ik ben *Maxim*, investment analyst bij House Tenerife — ik help met vastgoed en investeringsprojecten (Tenerife, Dubai, Ibiza, Marbella, Málaga, Barcelona en meer, catalogus housetenerife.eu).\n\nOm te beginnen: zoeken jullie *om te wonen* of *om te investeren*? Of typ /help voor commando’s.',
    help: `Beschikbare commando’s:
/start - Start met de bot
/help - Toon hulp
/status - Controleer botstatus
/time - Huidige tijd
/site - Catalogus housetenerife.eu
/ping - Check of de bot je ziet

Schrijf me gewoon een bericht — ik antwoord in het Nederlands.`,
    status: 'Bot werkt! Status: klaar',
    time: 'Huidige tijd:',
    site: 'Officiële House Tenerife-site met objecten:',
    echo: 'Je schreef:',
    useHelp: 'Gebruik /help voor de lijst met commando’s.',
    error: 'Er ging iets mis bij het verwerken van het bericht. Probeer opnieuw.',
    ciphertext_reply:
      'Bericht ontvangen, maar ik kan de tekst niet lezen (versleuteld/eenmalig). Stuur een normaal tekstbericht.',
    voice_reply:
      'Ik kan spraakberichten niet beluisteren.\n\nSchrijf me in *tekst* — of zeg of je een belletje met {manager_name} wilt over je aanvraag.',
    manager_handoff:
      'Top{client_name_part}! Ik heb je aanvraag doorgegeven — *{manager_name}* schrijft je zo via WhatsApp.\n\nJe kunt ook eerst zelf schrijven: {manager_phone}\n\nIntussen kan ik hier de selectie verfijnen of vragen beantwoorden.',
    manager_handoff_image:
      'Top{client_name_part}! Ik heb je aanvraag doorgegeven — *{manager_name}* schrijft je zo via WhatsApp.\n\nJe kunt ook eerst zelf schrijven: {manager_phone}',
    manager_handoff_link:
      'Top{client_name_part}! Ik heb je aanvraag doorgegeven — *{manager_name}* schrijft je zo via WhatsApp.\n\nJe kunt ook eerst zelf schrijven: {manager_phone}',
    handoff_ask_name:
      'Prima, laten we een kort belletje plannen voor de details.\n\n*Hoe mogen we je aanspreken?*',
    handoff_name_invalid:
      'Schrijf alsjeblieft hoe we je moeten aanspreken (je naam).'
  },
  tr: {
    start:
      'Merhaba! Ben *Maxim*, House Tenerife yatırım analisti — gayrimenkul ve yatırım projelerinde yardımcı oluyorum (Tenerife, Dubai, Ibiza, Marbella, Málaga, Barcelona ve daha fazlası, katalog housetenerife.eu).\n\nBaşlamak için: *oturmak* mı yoksa *yatırım* mı arıyorsunuz? Komutlar için /help yazın.',
    help: `Komutlar:
/start - Sohbeti başlat
/help - Yardımı göster
/status - Bot durumunu kontrol et
/time - Şu anki saat
/site - housetenerife.eu kataloğu
/ping - Botun sizi görüp görmediğini kontrol et

Bana yazın — Türkçe yanıtlarım.`,
    status: 'Bot çalışıyor! Durum: hazır',
    time: 'Şu anki saat:',
    site: 'House Tenerife katalog:',
    echo: 'Yazdınız:',
    useHelp: 'Komut listesi için /help kullanın.',
    error: 'Mesaj işlenirken bir hata oluştu. Lütfen tekrar deneyin.',
    ciphertext_reply:
      'Mesaj alındı ama metni okuyamıyorum (şifreli veya tek kullanımlık). Lütfen normal bir metin gönderin.',
    voice_reply:
      'Sesli mesajları dinleyemiyorum.\n\nLütfen *yazıyla* yazın — veya {manager_name} ile görüşmek istediğinizi söyleyin.',
    manager_handoff:
      'Harika{client_name_part}! Talebinizi ilettim — *{manager_name}* kısa süre içinde WhatsApp’tan yazacak.\n\nİsterseniz önce siz yazın: {manager_phone}\n\nBeklerken seçimi burada netleştirebilirim.',
    manager_handoff_image:
      'Harika{client_name_part}! Talebinizi ilettim — *{manager_name}* kısa süre içinde WhatsApp’tan yazacak.\n\nİsterseniz önce siz yazın: {manager_phone}',
    manager_handoff_link:
      'Harika{client_name_part}! Talebinizi ilettim — *{manager_name}* kısa süre içinde WhatsApp’tan yazacak.\n\nİsterseniz önce siz yazın: {manager_phone}',
    handoff_ask_name:
      'Tabii — kısa bir görüşme ayarlayalım.\n\n*Size nasıl hitap edelim?*',
    handoff_name_invalid:
      'Lütfen size nasıl hitap edeceğimizi yazın (adınız).'
  },
  uk: {
    start:
      'Привіт! Я *Максим*, інвестиційний аналітик House Tenerife — допоможу з нерухомістю та інвестпроєктами (Тенерифе, Дубай, Ібіца, Марбелья, Малага, Барселона тощо, каталог housetenerife.eu).\n\nДля початку: шукаєте *для життя* чи *для інвестиції*? Або /help для команд.',
    help: `Доступні команди:
/start - Почати роботу з ботом
/help - Показати довідку
/status - Перевірити стан бота
/time - Поточний час
/site - Каталог housetenerife.eu
/ping - Перевірити, чи бачить вас бот

Просто напишіть запит — відповім українською.`,
    status: 'Бот працює! Стан: готовий до роботи',
    time: 'Поточний час:',
    site: 'Каталог House Tenerife:',
    echo: 'Ви написали:',
    useHelp: 'Використовуйте /help для списку команд.',
    error: 'Сталася помилка при обробці повідомлення. Спробуйте ще раз.',
    ciphertext_reply:
      'Повідомлення отримано, але я не бачу текст (шифроване або одноразове). Напишіть, будь ласка, звичайним текстом.',
    voice_reply:
      'Я не можу прослуховувати голосові повідомлення.\n\nНапишіть *текстом* — або скажіть, якщо хочете дзвінок з {manager_name}.',
    manager_handoff:
      'Чудово{client_name_part}! Я передав заявку — *{manager_name}* напише вам у WhatsApp найближчим часом.\n\nМожете написати першим: {manager_phone}\n\nПоки чекаєте, можу уточнити підбірку або відповісти тут.',
    manager_handoff_image:
      'Чудово{client_name_part}! Я передав заявку — *{manager_name}* напише вам у WhatsApp найближчим часом.\n\nМожете написати першим: {manager_phone}',
    manager_handoff_link:
      'Чудово{client_name_part}! Я передав заявку — *{manager_name}* напише вам у WhatsApp найближчим часом.\n\nМожете написати першим: {manager_phone}',
    handoff_ask_name:
      'Добре, давайте коротко созвонимося.\n\n*Як до вас звертатися?*',
    handoff_name_invalid:
      'Напишіть, будь ласка, як до вас звертатися (ім’я).'
  },
  // Для остальных языков (zh, ja, ko, hi, ar) будет использоваться английский как fallback
};

/**
 * Определяет страну по номеру телефона
 * @param {string} phoneNumber - Номер телефона (может быть в формате 79991234567@c.us или +79991234567)
 * @returns {string|null} - Код страны (например, 'RU', 'ES') или null если не удалось определить
 */
function getCountryFromPhone(phoneNumber) {
  try {
    // Пропускаем специальные форматы (@lid, @g.us для групп, и т.д.)
    if (phoneNumber.includes('@lid') || phoneNumber.includes('@g.us') || phoneNumber.includes('@broadcast')) {
      return null;
    }
    
    // Убираем @c.us или @g.us из конца (формат WhatsApp)
    let cleanNumber = phoneNumber.replace(/@[cg]\.us$/, '');
    
    // Если номер не содержит цифр или слишком короткий, пропускаем
    if (!/\d/.test(cleanNumber) || cleanNumber.length < 5) {
      return null;
    }
    
    // Если номер начинается с +, используем его как есть
    // Если нет, добавляем + (предполагаем, что это международный формат)
    if (!cleanNumber.startsWith('+')) {
      cleanNumber = '+' + cleanNumber;
    }
    
    // Парсим номер телефона
    const phoneNumberObj = parsePhoneNumber(cleanNumber);
    
    if (phoneNumberObj && phoneNumberObj.isValid()) {
      const countryCode = phoneNumberObj.country;
      console.log(`🌍 Определена страна для номера ${phoneNumber}: ${countryCode}`);
      return countryCode;
    }
    
    return null;
  } catch (error) {
    // Не логируем ошибку для специальных форматов (@lid и т.д.)
    if (!phoneNumber.includes('@lid') && !phoneNumber.includes('@g.us')) {
      console.error('❌ Ошибка определения страны по номеру:', error);
    }
    return null;
  }
}

/**
 * Определяет язык пользователя по номеру телефона
 * @param {string} phoneNumber - Номер телефона
 * @returns {string} - Код языка (например, 'ru', 'es', 'en'), по умолчанию 'en'
 */
function getLanguageFromPhone(phoneNumber) {
  const raw = String(phoneNumber || '');
  // @lid — не телефон и не страна; язык только из текста диалога
  if (raw.includes('@lid') || raw.includes('@g.us') || raw.includes('@broadcast')) {
    return null;
  }

  const countryCode = getCountryFromPhone(phoneNumber);

  if (countryCode && countryToLanguage[countryCode]) {
    const language = countryToLanguage[countryCode];
    console.log(`🗣️ Определен язык для страны ${countryCode}: ${language}`);
    return language;
  }

  return 'en';
}

/**
 * Получает перевод текста на нужном языке
 * @param {string} language - Код языка
 * @param {string} key - Ключ перевода
 * @returns {string} - Переведенный текст
 */
function getTranslation(language, key) {
  const raw = String(language || 'en').toLowerCase().slice(0, 2);
  const mapped = raw === 'be' ? 'ru' : raw;
  const langPack = translations[mapped] || translations.en;
  const aliases = {
    manager_handoff: ['handoff'],
    manager_handoff_image: ['handoff_photo', 'handoff'],
    manager_handoff_link: ['handoff_link', 'handoff'],
    handoff_ask_name: ['ask_name'],
    handoff_name_invalid: ['ask_name_retry'],
    handoff: ['manager_handoff'],
    handoff_photo: ['manager_handoff_image', 'manager_handoff'],
    handoff_link: ['manager_handoff_link', 'manager_handoff'],
    ask_name: ['handoff_ask_name'],
    ask_name_retry: ['handoff_name_invalid'],
  };
  const keysToTry = [key, ...(aliases[key] || [])];
  for (const k of keysToTry) {
    if (langPack[k]) return langPack[k];
  }
  for (const k of keysToTry) {
    if (translations.en[k]) return translations.en[k];
  }
  for (const k of keysToTry) {
    if (translations.ru[k]) return translations.ru[k];
  }
  return key;
}

/**
 * Форматирует номер телефона для WhatsApp
 * @param {string} phoneNumber - Номер телефона в любом формате
 * @returns {string} - Номер в формате 79991234567@c.us
 */
function formatPhoneNumber(phoneNumber) {
  // Убираем все нецифровые символы, кроме +
  let cleaned = phoneNumber.replace(/[^\d+]/g, '');
  
  // Если номер начинается с +, убираем его
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1);
  }
  
  // Если номер начинается с 8, заменяем на 7
  if (cleaned.startsWith('8')) {
    cleaned = '7' + cleaned.substring(1);
  }
  
  // Если номер не начинается с кода страны, добавляем 7 (для России)
  if (cleaned.length === 10) {
    cleaned = '7' + cleaned;
  }
  
  return `${cleaned}@c.us`;
}

module.exports = {
  getCountryFromPhone,
  getLanguageFromPhone,
  getTranslation,
  formatPhoneNumber,
  countryToLanguage,
  translations
};
