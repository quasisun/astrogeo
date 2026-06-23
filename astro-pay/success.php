<?php
/* success.php — страница, куда Робокасса отправляет клиента ПОСЛЕ оплаты.
   Проверяет подпись Робокассы (реальная оплата), берёт данные из сессии,
   шлёт письмо со ссылкой на отчёт. Адрес для Робокассы («страница успеха после оплаты»):
     https://vedastro.ru/astro-pay/success.php
*/
ini_set('display_errors', '0');
error_reporting(E_ALL & ~E_DEPRECATED & ~E_NOTICE);

session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'samesite' => 'Lax']);
session_start();

$cfg = require __DIR__ . '/config.php';
require __DIR__ . '/lib.php';
$logFile = __DIR__ . '/log.php';
if (!is_file($logFile)) @file_put_contents($logFile, "<?php exit; /* astro-pay log */ ?>\n");

// 1) Логируем всё, что прислала Робокасса (для отладки на первом тесте).
@file_put_contents($logFile, date('Y-m-d H:i:s')
    . " | SUCCESS GET=" . json_encode($_GET, JSON_UNESCAPED_UNICODE)
    . " POST=" . json_encode($_POST, JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND);

// 2) Проверяем подпись Робокассы: SignatureValue = md5("OutSum:InvId:Пароль1").
$out = $_REQUEST['OutSum'] ?? ($_REQUEST['outSum'] ?? '');
$inv = $_REQUEST['InvId'] ?? ($_REQUEST['invId'] ?? '');
$sig = strtolower($_REQUEST['SignatureValue'] ?? ($_REQUEST['signatureValue'] ?? ''));
$calc = strtolower(md5($out . ':' . $inv . ':' . $cfg['robokassa_pass1']));
$paid = ($sig !== '' && $sig === $calc);

@file_put_contents($logFile, date('Y-m-d H:i:s')
    . " | SUCCESS paid=" . ($paid ? '1' : '0') . " out=$out inv=$inv sigOk=" . ($sig === $calc ? '1' : '0') . "\n", FILE_APPEND);

$order = $_SESSION['acg_order'] ?? null;
$sent  = false;

// 3) Если оплата подтверждена и есть данные заказа — шлём письмо.
if ($paid && $order && !empty($order['email'])) {
    $d = acg_normalize_date($order['date']);
    $t = acg_normalize_time($order['time']);
    list($lat, $lon, $label) = acg_geocode($order['city']);
    if ($lat !== null) {
        $co   = acg_region_to_co($order['region']);
        $link = acg_build_link($cfg['app_base'], $order['name'], $d, $t, $label, $lat, $lon, $co);
        $subj = 'Ваш полный отчёт по астрокартографии';
        $body = acg_email_html($order['name'], $link, $d, $t, $label);
        $sent = acg_send_unisender($cfg, $order['email'], $subj, $body, $logFile);
        if (!empty($cfg['bcc_to'])) {
            acg_send_unisender($cfg, $cfg['bcc_to'], '[копия] ' . $subj,
                'Заказ: ' . htmlspecialchars($order['name']) . ', ' . $d . ' ' . $t . ', ' . htmlspecialchars($label)
                . ', почта: ' . htmlspecialchars($order['email']) . '<br><br>' . $body, $logFile);
        }
        unset($_SESSION['acg_order']); // одноразово — защита от повторов
    } else {
        // город не распознан — сообщаем владельцу
        if (!empty($cfg['bcc_to'])) {
            acg_send_unisender($cfg, $cfg['bcc_to'], 'Астро-заказ: город не распознан (ручная обработка)',
                'Оплата прошла, но город не распознан: ' . htmlspecialchars($order['city'])
                . '<br>Имя: ' . htmlspecialchars($order['name']) . '<br>Дата/время: ' . $d . ' ' . $t
                . '<br>Почта: ' . htmlspecialchars($order['email']), $logFile);
        }
    }
}

// 4) Страница для клиента.
header('Content-Type: text/html; charset=utf-8');
$msg = $sent
    ? 'Спасибо за оплату! Ссылка на ваш полный отчёт отправлена на почту — проверьте входящие (и папку «Спам») через несколько минут.'
    : 'Спасибо за оплату! Ваш отчёт формируется и придёт на почту в ближайшее время. Если письма нет в течение часа — напишите нам: ' . htmlspecialchars($cfg['bcc_to'] ?? 'info@goroskop1008.ru') . '.';
?>
<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Спасибо за заказ</title></head>
<body style="font-family:Arial,sans-serif;background:#fff;color:#2a2326;margin:0;padding:40px 20px;text-align:center">
  <div style="max-width:520px;margin:0 auto">
    <div style="font-size:48px;color:#1FA84F;line-height:1">✓</div>
    <h1 style="color:#df2227;font-size:24px;margin:16px 0 12px">Оплата получена</h1>
    <p style="font-size:16px;line-height:1.6"><?php echo $msg; ?></p>
    <p style="margin-top:28px"><a href="https://goroskop1008.ru" style="color:#df2227">goroskop1008.ru</a></p>
  </div>
</body></html>
