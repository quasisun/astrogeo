<?php
/* lib.php — функции «почтальона» (без побочных эффектов, удобно тестировать).
   Используется webhook.php. Не требует сторонних библиотек (только cURL). */

/** Нормализовать дату к виду YYYY-MM-DD (принимает 15.05.1990, 1990-05-15, 15/05/1990). */
function acg_normalize_date($s) {
    $s = trim((string)$s);
    if (preg_match('/^(\d{4})-(\d{1,2})-(\d{1,2})$/', $s, $m)) {
        return sprintf('%04d-%02d-%02d', $m[1], $m[2], $m[3]);
    }
    if (preg_match('#^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$#', $s, $m)) {
        return sprintf('%04d-%02d-%02d', $m[3], $m[2], $m[1]); // ДД.ММ.ГГГГ
    }
    $ts = strtotime($s);
    return $ts ? date('Y-m-d', $ts) : $s;
}

/** Нормализовать время к виду HH:MM (принимает 8:30, 08:30, "10 08", 8). */
function acg_normalize_time($s) {
    $s = trim((string)$s);
    if (preg_match('/^(\d{1,2})[:\.](\d{2})/', $s, $m)) return sprintf('%02d:%02d', $m[1], $m[2]);
    if (preg_match('/^(\d{1,2})\s+(\d{2})$/', $s, $m)) return sprintf('%02d:%02d', $m[1], $m[2]);
    if (preg_match('/^(\d{1,2})$/', $s, $m))            return sprintf('%02d:00', $m[1]);
    return $s !== '' ? $s : '12:00';
}

/** Геокодирование города через Nominatim (OpenStreetMap). Возврат [lat, lon, label] или [null,null,null]. */
function acg_geocode($city) {
    $city = trim((string)$city);
    if ($city === '') return [null, null, null];
    $url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=ru&q=' . rawurlencode($city);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_USERAGENT      => 'jyotish-acg/1.0 (info@goroskop1008.ru)',
        CURLOPT_HTTPHEADER     => ['Accept: application/json'],
    ]);
    $res = curl_exec($ch);
    if (!$res) return [null, null, null];
    $arr = json_decode($res, true);
    if (empty($arr[0]['lat']) || empty($arr[0]['lon'])) return [null, null, null];
    return [round((float)$arr[0]['lat'], 4), round((float)$arr[0]['lon'], 4), $city];
}

/** Собрать ссылку на полный отчёт в формате, который понимает приложение (#<urlencoded JSON>). */
function acg_build_link($appBase, $name, $d, $t, $label, $lat, $lon) {
    $payload = [
        'd'  => $d, 't' => $t, 'tz' => 'auto', 'o' => 'no',
        'nm' => $name, 'cl' => '', 'co' => '',
        'pl' => $label . '|' . $lat . '|' . $lon,
    ];
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE);
    return rtrim($appBase, '/') . '/#' . rawurlencode($json);
}

/** Признак оплаченного заказа в данных от Tilda. На тесте уточним по логу. */
function acg_is_paid($data) {
    if (!empty($data['payment'])) {
        $p = $data['payment'];
        if (is_array($p)) return !empty($p['amount']) || !empty($p['systranid']) || !empty($p['orderid']);
        return true;
    }
    foreach (['paymentamount', 'amount', 'payment_amount', 'systranid'] as $k) {
        if (!empty($data[$k])) return true;
    }
    return false;
}

/** HTML письма клиенту со ссылкой на отчёт. */
function acg_email_html($name, $link, $d, $t, $city) {
    $n = htmlspecialchars($name, ENT_QUOTES, 'UTF-8');
    $c = htmlspecialchars($city, ENT_QUOTES, 'UTF-8');
    $u = htmlspecialchars($link, ENT_QUOTES, 'UTF-8');
    return '<div style="font-family:Arial,sans-serif;font-size:15px;color:#2a2326;line-height:1.6">'
        . '<p>Здравствуйте' . ($n ? ', ' . $n : '') . '!</p>'
        . '<p>Спасибо за заказ. Ваш персональный полный отчёт по астрокартографии готов:</p>'
        . '<p><a href="' . $u . '" style="display:inline-block;background:#df2227;color:#fff;'
        . 'text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">Открыть мой полный отчёт</a></p>'
        . '<p style="font-size:13px;color:#6b6166">Данные расчёта: ' . $d . ' ' . $t . ', ' . $c . '.<br>'
        . 'Если кнопка не открывается, скопируйте ссылку:<br>'
        . '<span style="word-break:break-all">' . $u . '</span></p>'
        . '<p style="font-size:13px;color:#6b6166">С уважением,<br>Светлана Кройцер · '
        . '<a href="https://goroskop1008.ru">goroskop1008.ru</a></p>'
        . '</div>';
}

/** Отправка письма через API Unisender (метод sendEmail). Возврат true/false. Пишет ответ в лог. */
function acg_send_unisender($cfg, $to, $subject, $bodyHtml, $logFile = null) {
    $params = [
        'format'       => 'json',
        'api_key'      => $cfg['unisender_key'],
        'email'        => $to,
        'sender_name'  => $cfg['sender_name'],
        'sender_email' => $cfg['sender_email'],
        'subject'      => $subject,
        'body'         => $bodyHtml,
        'list_id'      => $cfg['unisender_list'],
        'lang'         => 'ru',
    ];
    $ch = curl_init('https://api.unisender.com/ru/api/sendEmail?format=json');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => http_build_query($params),
        CURLOPT_TIMEOUT        => 20,
    ]);
    $res = curl_exec($ch);
    $err = curl_error($ch);
    if ($logFile) {
        @file_put_contents($logFile, date('Y-m-d H:i:s') . " | UNISENDER to=$to resp=$res err=$err\n", FILE_APPEND);
    }
    $j = json_decode($res, true);
    return isset($j['result']);
}
