"use strict";

angular.module('calaosApp').directive('calaosCamera',
[ '$timeout', function($timeout) {

    return {
        restrict: 'AE',
        replace: true,
        template: '<div></div>',
        link: function($scope, elem, attrs) {

            var canvas = document.createElement('canvas');
            canvas.width = elem.width();
            canvas.height = elem.height();
            elem.append(canvas);
            var ctx = canvas.getContext('2d');
            var img = new Image();
            img.src = attrs.src;

            var draw = function () {
                //clear canvas
                canvas.width = canvas.width;

                if (img.width * img.height > 0) {
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                }
            };

            var picLoaded = function (e) {
                draw();
                $timeout(function() {
                    //reload image with random parameter to force cache update
                    img.src = attrs.src + '&' + new Date().getTime();
                }, 10);
            };

            img.onload = picLoaded;
        }
    };

}]);
