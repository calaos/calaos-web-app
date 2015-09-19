
/*
 * Here you can override the default detected ws://hostname/api used by
 * the app. It allows you to run gulp serve (on 9000 port) and connect to
 * a your calaos_server on a different host:port.
 *
 * Note: don't forget: git update-index --assume-unchanged src/scripts/dev_config.js
 * to avoid commit this file with non default values!
 */

 var calaosDevConfig = {
     calaosServerHost: '',
 };
