<?php
/* webhook.php — «почтальон»: принимает заказ от Tilda → собирает ссылку на полный отчёт
   → отправляет письмо клиенту через Unisender. Кладётся на vedastro.ru (Бегет, PHP).
   Адрес для Tilda:  https://vedastro.ru/astro-pay/webhook.php?key=ВАШ_SECRET   */

ini_set('display_errors', '0');                 // чтобы предупреждения не попадали в ответ Tilda
error_reporting(E_ALL & ~E_DEPRECATED & ~E_NOTICE);
header('Content-Type: text/plain; charset=utf-8');

$cfgFile = __DIR__ . '/config.php';
if (!is_file($cfgFile)) { http_response_code(500); echo 'no config'; exit; }
$cfg = require $cfgFile;
require __DIR__ . '/lib.php';

// Лог в .php-файл с заглушкой: из браузера он ничего не отдаёт (защита данных клиентов),
// а вы читаете его через файловый менеджер.
$logFile = __DIR__ . '/log.php';
if (!is_file($logFile)) {
    @file_put_contents($logFile, "<?php exit; /* astro-pay log — не открывается из браузера */ ?>\n");
}

// 1) Логируем всё, что пришло (для отладки на тесте).
$raw = file_get_contents('php://input');
@file_put_contents($logFile, date('Y-m-d H:i:s')
    . " | GET=" . json_encode($_GET, JSON_UNESCAPED_UNICODE)
    . " | POST=" . json_encode($_POST, JSON_UNESCAPED_UNICODE)
    . " | RAW=" . $raw . "\n", FILE_APPEND);

// 2) Тестовый «пинг» от Tilda — просто отвечаем OK.
if (isset($_POST['test']) || isset($_GET['test'])) { echo 'OK (test)'; exit; }

// 3) Защита ключом — чужой не дёрнет вебхук.
if (($_GET['key'] ?? '') !== $cfg['secret']) { http_response_code(403); echo 'forbidden'; exit; }

// 4) Собираем данные (Tilda шлёт form-urlencoded; поддержим и JSON).
$data = $_POST;
if (!$data && $raw) { $j = json_decode($raw, true); if (is_array($j)) $data = $j; }

$name   = trim($data[$cfg['field_name']]  ?? '');
$date   = trim($data[$cfg['field_date']]  ?? '');
$time   = trim($data[$cfg['field_time']]  ?? '');
$city   = trim($data[$cfg['field_city']]  ?? '');
$email  = trim($data[$cfg['field_email']] ?? '');
$region = trim($data[$cfg['field_region'] ?? 'region'] ?? '');   // «Весь мир» / «Только по России»

// 4.1) Это наша астро-форма? У других форм сайта нет полей даты/города — их игнорируем.
if ($date === '' || $city === '') { echo 'OK (not this form)'; exit; }

// 5) Только оплаченные заказы (иначе письмо не шлём).
if (!empty($cfg['require_payment']) && !acg_is_paid($data)) { echo 'OK (no payment yet)'; exit; }

// 6) Нормализуем дату/время.
$d = acg_normalize_date($date);
$t = acg_normalize_time($time);

// 7) Определяем координаты города.
list($lat, $lon, $label) = acg_geocode($city);
if ($lat === null) {
    // Город не распознан — сообщаем Светлане, чтобы обработала вручную.
    if (!empty($cfg['bcc_to'])) {
        acg_send_unisender($cfg, $cfg['bcc_to'], 'Астро-заказ: город не распознан (ручная обработка)',
            'Не удалось определить координаты города.<br>Имя: ' . htmlspecialchars($name)
            . '<br>Дата/время: ' . $d . ' ' . $t . '<br>Город: ' . htmlspecialchars($city)
            . '<br>Почта клиента: ' . htmlspecialchars($email), $logFile);
    }
    echo 'OK (geocode failed, notified)';
    exit;
}

// 8) Собираем ссылку (с учётом региона) и шлём письмо клиенту.
$co      = acg_region_to_co($region);
$link    = acg_build_link($cfg['app_base'], $name, $d, $t, $label, $lat, $lon, $co);
$subject = 'Ваш полный отчёт по астрокартографии';
$body    = acg_email_html($name, $link, $d, $t, $label);

$ok = false;
if ($email !== '') {
    $ok = acg_send_unisender($cfg, $email, $subject, $body, $logFile);
}

// 9) Копия Светлане (контроль + страховка).
if (!empty($cfg['bcc_to'])) {
    acg_send_unisender($cfg, $cfg['bcc_to'], '[копия] ' . $subject,
        'Заказ: ' . htmlspecialchars($name) . ', ' . $d . ' ' . $t . ', ' . htmlspecialchars($label)
        . ', почта: ' . htmlspecialchars($email) . '<br><br>' . $body, $logFile);
}

echo $ok ? 'OK' : 'OK (see log)';
