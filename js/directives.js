'use strict';

/* Directives */

calaos.directive("colorPicker", function(){
    return {
        restrict: "A",
        scope: {
            url: '=',
        },
        link: function(scope, element){
            var ctx = element[0].getContext('2d');
            var onHold = false;
            var lastX;
            var lastY;
            var w,h;

            console.log(element);

            element[0].style.width='100%';
            element[0].style.height='100%';
            element[0].width  = element[0].offsetWidth;
            element[0].height = element[0].offsetWidth;


            element[0].style.cursor = 'url("img/color-wheel-selector.png") 24 24, pointer';

            var image = new Image();

            image.src = scope.url;

            image.onload = function () {
                ctx.scale( element[0].width / image.width , element[0].width/ image.height);
                ctx.drawImage(image, 0, 0, image.width, image.height); // draw the image on the canvas
            }

            function getColor() {
                // get coordinates of current position
                var rect = element[0].getBoundingClientRect();
                var x = event.clientX - rect.left; //12 == half pointer size ?
                var y = event.clientY - rect.top;



                // get current pixel
                var imageData = ctx.getImageData(x, y, 1, 1);
                var pixel = imageData.data;
                var pixelColor = "rgb("+pixel[0]+", "+pixel[1]+", "+pixel[2]+")";

                /* Check Alpha, if color is not fully opaque, it's not returned : BIG HACK*/
                /* It's to avoid a check if the mouse is inside the circle */
                /* We need so a colorpicker image with alpha values for elements wich
                  don't want to be picked */
                if (pixel[3] == 255)
                    return pixelColor;

            }


            element.bind('mousedown', function(event){
                onHold = true;
            });
            element.bind('mousemove', function(event){
                var currentX, currentY;
                if(onHold)
                { 
                    var color = getColor();
                    if (color != null)
                        document.getElementById("color").style.backgroundColor = getColor();
                }
            });
            element.bind('mouseup', function(event){
                if (onHold)
                {
                    onHold = false;
                    if (color != null)
                        document.getElementById("color").style.backgroundColor = getColor();
                }
            });
            // canvas reset
            function reset(){
                element[0].width = element[0].width;
            }
        }
    };
});
