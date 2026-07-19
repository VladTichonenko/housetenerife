'use strict';

const { setPendingCallOffer } = require('./handoff-pending');
const { shouldTrackCallOfferAfterReply } = require('./manager-handoff');
const { analyzeConversation } = require('./dialog-context');

/**
 * Мягкое предложение созвона через AI (без мгновенного handoff).
 */
async function offerSoftCallViaAi(ctx) {
  const {
    msg,
    client,
    chatId,
    dialogLanguage,
    reasonKey,
    preview,
    messageText,
    userLine,
    sendMessageSafely,
    withChatTyping,
    askAI,
    getHistory,
    addToHistory,
    localizeUrlsInText,
  } = ctx;

  if (userLine) addToHistory(chatId, 'user', userLine);

  const aiResponse = await withChatTyping(msg, () => askAI(getHistory(chatId), dialogLanguage));
  const outgoing = localizeUrlsInText(aiResponse, dialogLanguage);
  addToHistory(chatId, 'assistant', outgoing);
  await sendMessageSafely(msg, outgoing, client);

  const dialog = analyzeConversation(getHistory(chatId), dialogLanguage);
  // Ставим pending только если AI реально предложил созвон — не из‑за одного reasonKey
  if (shouldTrackCallOfferAfterReply(dialog, outgoing)) {
    setPendingCallOffer(chatId, {
      reasonKey: reasonKey || 'handoff',
      preview: preview || messageText || userLine || '',
      language: dialogLanguage,
    });
    console.log(`📞 Ожидание ответа на предложение созвона (${reasonKey || 'handoff'}): ${chatId}`);
  }
}

module.exports = { offerSoftCallViaAi };
