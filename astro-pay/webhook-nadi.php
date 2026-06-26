<?php
/* webhook-nadi.php — «почтальон» для гороскопа Джйотиш-наади.
   Принимает оплаченный заказ Tilda → собирает ссылку на готовый гороскоп → письмо клиенту.
   Адрес для Tilda:  https://vedastro.ru/astro-pay/webhook-nadi.php?key=ВАШ_SECRET
   Использует общий config.php и lib.php рядом. Астро-вебхук (webhook.php) НЕ затрагивает. */

ini_set('display_errors', '0');                 // чтобы предупреждения не попадали в ответ Tilda
error_reporting(E_ALL & ~E_DEPRECATED & ~E_NOTICE);
header('Content-Type: text/plain; charset=utf-8');

$cfgFile = __DIR__ . '/config.php';
if (!is_file($cfgFile)) { http_response_code(500); echo 'no config'; exit; }
$cfg = require $cfgFile;
require __DIR__ . '/lib.php';

// Тот же лог, что у астро-вебхука (из браузера не открывается).
$logFile = __DIR__ . '/log.php';
if (!is_file($logFile)) {
    @file_put_contents($logFile, "<?php exit; /* astro-pay log — не открывается из браузера */ ?>\n");
}

// 1) Логируем всё, что пришло (помечаем как NADI).
$raw = file_get_contents('php://input');
@file_put_contents($logFile, date('Y-m-d H:i:s')
    . " | NADI GET=" . json_encode($_GET, JSON_UNESCAPED_UNICODE)
    . " | POST=" . json_encode($_POST, JSON_UNESCAPED_UNICODE)
    . " | RAW=" . $raw . "\n", FILE_APPEND);

// 2) Тестовый «пинг».
if (isset($_POST['test']) || isset($_GET['test'])) { echo 'OK (test)'; exit; }

// 3) Защита ключом (тот же secret, что и у астро-вебхука).
if (($_GET['key'] ?? '') !== $cfg['secret']) { http_response_code(403); echo 'forbidden'; exit; }

// 4) Данные (form-urlencoded или JSON), регистронезависимо.
$data = $_POST;
if (!$data && $raw) { $j = json_decode($raw, true); if (is_array($j)) $data = $j; }
$L = array_change_key_case($data, CASE_LOWER);
$g = function ($key) use ($L) { return trim($L[strtolower($key)] ?? ''); };

$name  = $g($cfg['field_name']);
$date  = $g($cfg['field_date']);
$time  = $g($cfg['field_time']);
$city  = $g($cfg['field_city']);
$email = $g($cfg['field_email']);
$sexIn = $g($cfg['field_sex'] ?? 'bsex');

// 4.1) Это наша форма наади? (нет даты/города — чужая форма, игнорируем)
if ($date === '' || $city === '') { echo 'OK (not this form)'; exit; }

// 5) Только оплаченные заказы.
if (!empty($cfg['require_payment']) && !acg_is_paid($L)) { echo 'OK (no payment yet)'; exit; }

// 6) Нормализуем дату/время/пол.
$d   = acg_normalize_date($date);
$t   = acg_normalize_time($time);
$sex = nadi_sex($sexIn);

// 7) Координаты города.
list($lat, $lon, $label) = acg_geocode($city);
if ($lat === null) {
    if (!empty($cfg['bcc_to'])) {
        acg_send_unisender($cfg, $cfg['bcc_to'], 'Наади-заказ: город не распознан (ручная обработка)',
            'Не удалось определить координаты города.<br>Имя: ' . htmlspecialchars($name)
            . '<br>Дата/время: ' . $d . ' ' . $t . '<br>Город: ' . htmlspecialchars($city)
            . '<br>Пол: ' . $sex . '<br>Почта клиента: ' . htmlspecialchars($email), $logFile);
    }
    echo 'OK (geocode failed, notified)';
    exit;
}

// 8) Ссылка на гороскоп + письмо клиенту. Для наади можно отдельные список/имя отправителя.
$appBase = $cfg['nadi_app_base'] ?? 'https://quasisun.github.io/naadi/';
$tz      = nadi_tz_offset($lat, $lon, $d, $t); // зашиваем пояс в ссылку → одинаковая Лагна у всех
$link    = nadi_build_link($appBase, $d, $t, $label, $lat, $lon, $sex, $tz);
$subject = 'Ваш персональный гороскоп наади';
$body    = nadi_email_html($name, $link, $d, $t, $label);

$cfgN = $cfg;
if (!empty($cfg['nadi_unisender_list'])) $cfgN['unisender_list'] = $cfg['nadi_unisender_list'];
if (!empty($cfg['nadi_sender_name']))    $cfgN['sender_name']    = $cfg['nadi_sender_name'];

$ok = false;
if ($email !== '') {
    $ok = acg_send_unisender($cfgN, $email, $subject, $body, $logFile);
}

// 9) Копия Светлане.
if (!empty($cfg['bcc_to'])) {
    acg_send_unisender($cfgN, $cfg['bcc_to'], '[копия] ' . $subject,
        'Заказ наади: ' . htmlspecialchars($name) . ', ' . $d . ' ' . $t . ', ' . htmlspecialchars($label)
        . ', пол=' . $sex . ', почта: ' . htmlspecialchars($email) . '<br><br>' . $body, $logFile);
}

echo $ok ? 'OK' : 'OK (see log)';
