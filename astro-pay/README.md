# astro-pay — «почтальон» (вебхук Tilda → письмо со ссылкой на отчёт)

После оплаты Tilda зовёт этот скрипт; он собирает персональную ссылку на полный отчёт
и отправляет письмо клиенту через Unisender. Ставится на **vedastro.ru** (Бегет, PHP 8).

## Файлы

- `webhook.php` — точка входа (её адрес указывается в Tilda).
- `lib.php` — функции (нормализация даты/времени, геокод, сборка ссылки, отправка письма).
- `config.sample.php` — образец настроек. На сервере копируется в `config.php` и заполняется.
- `config.php`, `log.php` — **не** в репозитории (секреты и лог создаются на сервере;
  лог — `.php` с заглушкой, из браузера не читается, смотреть через файловый менеджер).

## Установка на vedastro.ru (Бегет)

1. В файловом менеджере Бегета зайти в корень сайта `vedastro.ru` (там, где `index`).
2. Создать папку `astro-pay`, загрузить в неё `webhook.php` и `lib.php`.
3. Загрузить `config.sample.php`, переименовать в `config.php`, открыть и заполнить:
   - `secret` — длинная случайная строка (тот же ключ потом в адресе вебхука `?key=...`);
   - `unisender_key`, `sender_email` (подтверждён в Unisender), `unisender_list` (id списка);
   - `bcc_to` — ваша почта для копий.
4. Проверка: открыть в браузере `https://vedastro.ru/astro-pay/webhook.php?test=1` → должно показать `OK (test)`.

## Подключение в Tilda

В настройках формы → приём данных/вебхук указать адрес:
```
https://vedastro.ru/astro-pay/webhook.php?key=ВАШ_SECRET
```
Переменные полей формы должны совпадать с `config.php` (`name`, `bdate`, `btime`, `bcity`, `email`).

## Джйотиш-наади (второй поток)

Рядом лежит `webhook-nadi.php` — отдельный «почтальон» для гороскопа наади
(приложение https://quasisun.github.io/naadi/). Он использует тот же `config.php` и `lib.php`,
а ссылку собирает в формате ридера наади (`#<JSON{date,time,lat,lon,sex,place,tab}>`).
Астро-поток (`webhook.php`) при этом не меняется.

- Адрес для формы наади в Tilda: `https://vedastro.ru/astro-pay/webhook-nadi.php?key=ВАШ_SECRET`
- Поля формы наади: `name`, `bdate`, `btime`, `bcity`, **`bsex`** (Мужской/Женский), `email`.
- Доп. ключи в `config.php`: `field_sex`, `nadi_app_base`, `nadi_unisender_list` (можно пусто — тот же список), `nadi_sender_name`.
- Проверка: `https://vedastro.ru/astro-pay/webhook-nadi.php?test=1` → `OK (test)`.

## Проверка оплаты

Письмо уходит только для оплаченных заказов (`require_payment => true`, функция `acg_is_paid`).
На первом тестовом заказе посмотреть `log.php` (через файловый менеджер) — там видно,
что именно присылает Tilda и когда, и при необходимости уточнить признак оплаты.
