'use strict';

function setCookie(key, value, days) {
    if (days) {
        var date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 *1000));
        var expires = "; expires=" + date.toGMTString();
    }
    else {
        var expires = "";
    }

    var value = key + "=" + value + expires + "; path=/";
    document.cookie = value
    console.log("Set cookie : " + value);
}

function getCookie(key) {
    var name = key + "=";
    var cookieArr = document.cookie.split(';');
    for(var i=0; i < cookieArr.length; i++) {
        var c = cookieArr[i];

        while (c.charAt(0)==' ')
            c = c.substring(1,c.length);

        if (c.indexOf(name) == 0) {
            var str = c.substring(name.length,c.length);
            console.log("Get cookie : " + name + " value: " + str);
            return str;
        }
    }
    return null;
}
