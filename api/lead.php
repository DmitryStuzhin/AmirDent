<?php
// Принимает заявку с формы записи и отправляет её ботом в Telegram.
// Токен бота лежит в config.php, который на сайт не выкладывается и в репозиторий не попадает.

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

// Без типа never в объявлении: он появился только в PHP 8.1, а на хостинге
// нередко стоит версия постарее — тогда файл не разбирается вообще.
function reply(int $status, array $body) {
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    reply(405, ['error' => 'method_not_allowed']);
}

// Ограничение частоты: не больше 5 заявок за 10 минут с одного адреса.
// Без него любой мог бы засыпать чат заявками, отправляя запросы напрямую.
$ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
$rateFile = sys_get_temp_dir() . '/amirdent-lead-' . sha1($ip) . '.txt';
$now = time();
$hits = is_file($rateFile)
    ? array_filter(
        array_map('intval', explode(',', (string) file_get_contents($rateFile))),
        static fn(int $t): bool => $t > $now - 600
    )
    : [];
if (count($hits) >= 5) {
    reply(429, ['error' => 'too_many_requests']);
}
$hits[] = $now;
file_put_contents($rateFile, implode(',', $hits), LOCK_EX);

$configFile = __DIR__ . '/config.php';
if (!is_file($configFile)) {
    error_log('lead.php: нет config.php — скопируйте config.example.php и впишите токен');
    reply(500, ['error' => 'not_configured']);
}
$config = require $configFile;

$raw = file_get_contents('php://input');
$data = json_decode($raw ?: '', true);
if (!is_array($data)) {
    reply(400, ['error' => 'bad_json']);
}

$field = static function (array $src, string $key, int $max): string {
    $value = isset($src[$key]) && is_string($src[$key]) ? trim($src[$key]) : '';
    return mb_substr($value, 0, $max);
};

// Скрытое поле-ловушка: живой посетитель его не видит и не заполняет.
if ($field($data, 'company', 10) !== '') {
    reply(200, ['ok' => true]);
}

$name    = $field($data, 'name', 80);
$phone   = $field($data, 'phone', 32);
$service = $field($data, 'service', 60);
$page    = $field($data, 'page', 200);

if (mb_strlen($name) < 2) {
    reply(400, ['error' => 'invalid_name']);
}
if (preg_match_all('/\d/u', $phone) < 10) {
    reply(400, ['error' => 'invalid_phone']);
}

$esc = static fn(string $s): string => htmlspecialchars($s, ENT_NOQUOTES, 'UTF-8');

$lines = [
    '🦷 <b>Новая заявка с сайта АмирДент</b>',
    '',
    '<b>Имя:</b> ' . $esc($name),
    '<b>Телефон:</b> ' . $esc($phone),
];
if ($service !== '') {
    $lines[] = '<b>Услуга:</b> ' . $esc($service);
}
$lines[] = '<b>Время:</b> ' . (new DateTime('now', new DateTimeZone('Europe/Moscow')))->format('d.m H:i') . ' (МСК)';
if ($page !== '') {
    $lines[] = '<b>Страница:</b> ' . $esc($page);
}

$payload = json_encode([
    'chat_id' => $config['chat_id'],
    'text' => implode("\n", $lines),
    'parse_mode' => 'HTML',
    'disable_web_page_preview' => true,
], JSON_UNESCAPED_UNICODE);

$ch = curl_init('https://api.telegram.org/bot' . $config['bot_token'] . '/sendMessage');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $payload,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 10,
]);
$response = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);

if ($response === false || $status !== 200) {
    // Заявку нельзя терять: пишем в лог рядом со скриптом, чтобы её можно было поднять вручную.
    error_log(sprintf(
        "lead.php: Telegram не принял заявку (%d %s). Имя: %s, телефон: %s, услуга: %s\n",
        $status,
        $curlError !== '' ? $curlError : (string) $response,
        $name,
        $phone,
        $service
    ), 3, __DIR__ . '/leads-failed.log');
    reply(502, ['error' => 'telegram_failed']);
}

reply(200, ['ok' => true]);
