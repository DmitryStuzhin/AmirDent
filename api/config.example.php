<?php
// Скопируйте этот файл в config.php и впишите свои значения.
// config.php не попадает в git — токен не должен оказаться в репозитории.

return [
    // Токен бота от @BotFather
    'bot_token' => '000000000:ЗАМЕНИТЕ_НА_ТОКЕН',

    // Куда присылать заявки. Узнать: написать боту /start, затем открыть
    // https://api.telegram.org/bot<ТОКЕН>/getUpdates и взять result[0].message.chat.id
    'chat_id' => '000000000',
];
