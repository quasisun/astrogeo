<?php
/* go.php — промежуточная страница ПЕРЕД оплатой.
   Запоминает данные клиента (из формы Tilda) в сессию и отправляет на оплату Робокассы.
   Адрес формы «страница успеха»:
     https://vedastro.ru/astro-pay/go.php?nm={Name}&d={bdate}&t={btime}&city={bcity}&email={Email}&region={region}
*/
ini_set('display_errors', '0');
error_reporting(E_ALL & ~E_DEPRECATED & ~E_NOTICE);

session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'samesite' => 'Lax']);
session_start();

$cfg = require __DIR__ . '/config.php';

$_SESSION['acg_order'] = [
    'name'   => trim($_GET['nm']     ?? ''),
    'date'   => trim($_GET['d']      ?? ''),
    'time'   => trim($_GET['t']      ?? ''),
    'city'   => trim($_GET['city']   ?? ''),
    'email'  => trim($_GET['email']  ?? ''),
    'region' => trim($_GET['region'] ?? ''),
    'ts'     => time(),
];

@file_put_contents(__DIR__ . '/log.php',
    date('Y-m-d H:i:s') . " | GO saved order: " . json_encode($_SESSION['acg_order'], JSON_UNESCAPED_UNICODE) . "\n",
    FILE_APPEND);

// Отправляем на оплату.
header('Location: ' . $cfg['robokassa_link']);
exit;
