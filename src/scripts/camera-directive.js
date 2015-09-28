"use strict";

angular.module('calaosApp').directive('magnificPopup',
    [
        "$compile",
        function($compile) {
            return {
                restrict: 'A',
                scope: {},
                link: function($scope, element, attr) {
                    attr.callbacks = {
                        ajaxContentAdded: function() {
                            var content = this.content;

                            var scope =  content.scope();
                            $compile(content)(scope);
                            scope.$digest();
                        }
                    };

                    attr.closeOnContentClick = true;

                    attr.type = "inline";
                    attr.mainClass = 'mfp-fade';
                    //attr.mainClass = 'mfp-with-zoom';
                    attr.closeBtnInside = false;
                    // attr.zoom = {
                    //     enabled: true, // By default it's false, so don't forget to enable it
                    //
                    //     duration: 300, // duration of the effect, in milliseconds
                    //     easing: 'ease-in-out', // CSS transition easing function
                    //
                    //     // The "opener" function should return the element from which popup will be zoomed in
                    //     // and to which popup will be scaled down
                    //     // By defailt it looks for an image tag:
                    //     opener: function(openerElement) {
                    //         // openerElement is the element on which popup was initialized, in this case its <a> tag
                    //         // you don't need to add "opener" option if this code matches your needs, it's defailt one.
                    //         return openerElement.is('img') ? openerElement : openerElement.find('img');
                    //     }
                    // };
                    attr.callbacks.close = function() {
                        $(element.href).removeClass('mfp-hide');
                    };

                    element.magnificPopup(attr);
                }
            }
        }
    ]
);
