<?php
// Диагностика приёма заявок. Открыть в браузере: https amirdent.ru/api/check.php
// Показывает, чего не хватает хостингу, и не раскрывает токен.
// После проверки файл можно удалить — он нужен только для настройки.

header('Content-Type: text/plain; charset=utf-8');

$ok = true;
$line = function ($label, $good, $value) use (&$ok) {
    if (!$good) {
        $ok = false;
    }
    echo ($good ? '[ OK ]   ' : '[ НЕТ ]  ') . $label . ': ' . $value . "\n";
};

echo "Проверка приёма заявок — АмирДент\n";
echo str_repeat('=', 52) . "\n\n";

// 1. PHP выполняется — если вы это читаете, значит выполняется
$line('PHP работает, версия', version_compare(PHP_VERSION, '7.4', '>='), PHP_VERSION . ' (нужна 7.4 и новее)');

// 2. Расширения
$line('Расширение curl', extension_loaded('curl'), extension_loaded('curl') ? 'есть' : 'нет — попросите хостинг включить');
$line('Расширение mbstring', extension_loaded('mbstring'), extension_loaded('mbstring') ? 'есть' : 'нет — попросите хостинг включить');

// 3. Сам скрипт заявок
$leadOk = is_file(__DIR__ . '/lead.php');
$line('Файл lead.php', $leadOk, $leadOk ? 'на месте' : 'не найден — загрузите папку api целиком');

// 4. Настройки
$configFile = __DIR__ . '/config.php';
$configOk = is_file($configFile);
$config = $configOk ? require $configFile : [];
$tokenOk = $configOk && !empty($config['bot_token']) && strpos($config['bot_token'], ':') !== false;
$chatOk = $configOk && !empty($config['chat_id']);
$line('Файл config.php', $configOk, $configOk ? 'на месте' : 'не найден');
$line('Токен бота заполнен', $tokenOk, $tokenOk ? 'да (значение не показываем)' : 'нет или заполнен неверно');
$line('Получатель chat_id заполнен', $chatOk, $chatOk ? 'да' : 'нет');

// 5. Может ли хостинг вообще связаться с Telegram
if ($tokenOk && extension_loaded('curl')) {
    $ch = curl_init('https://api.telegram.org/bot' . $config['bot_token'] . '/getMe');
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10]);
    $body = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);

    if ($body === false) {
        $line('Связь с Telegram', false, 'не удалось соединиться — ' . $error
            . ' (хостинг блокирует исходящие подключения)');
    } elseif ($status === 401 || $status === 404) {
        // На неизвестный или отозванный токен Telegram отвечает 404, на битый — 401
        $line('Связь с Telegram', false, 'соединение есть, но токен не принят — он отозван или указан с ошибкой');
    } elseif ($status !== 200) {
        $line('Связь с Telegram', false, 'ответ ' . $status . ': ' . substr((string) $body, 0, 200));
    } else {
        $data = json_decode((string) $body, true);
        $name = isset($data['result']['username']) ? '@' . $data['result']['username'] : 'бот отвечает';
        $line('Связь с Telegram', true, $name);
    }
} else {
    $line('Связь с Telegram', false, 'не проверялась — сначала исправьте пункты выше');
}

echo "\n" . str_repeat('=', 52) . "\n";
echo $ok
    ? "Всё готово: заявки с формы должны доходить в Telegram.\n"
    : "Есть проблемы — смотрите строки с пометкой [ НЕТ ].\n";
echo "\nПосле настройки этот файл можно удалить.\n";
