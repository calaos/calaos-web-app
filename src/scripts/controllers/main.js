'use strict';

angular.module('calaosApp')
.controller('MainCtrl', ['$rootScope', '$scope', '$state', 'CalaosApp', '$window', 'preloader', function ($rootScope, $scope, $state, CalaosApp, $window, preloader) {

    $rootScope.isLoading = true;
    $scope.loadPercent = 0;

    $scope.imageLocations = [
        'images/style_icons/icon_default.png',
        'images/style_icons/icon_humidity.png',
        'images/background.png',
        'images/button_bool_off.png',
        'images/button_bool_on.png',
        'images/button_home.png',
        ('https://www.lifeofpix.com/wp-content/uploads/2018/03/stmoritz13.jpg?cache=' + (new Date()).getTime() ),
        ('https://www.lifeofpix.com/wp-content/uploads/2018/03/stmoritz13.jpg?v0&cache=' + (new Date()).getTime() ),
        ('https://www.lifeofpix.com/wp-content/uploads/2018/03/stmoritz13.jpg?v1&cache=' + (new Date()).getTime() ),
        ('https://www.lifeofpix.com/wp-content/uploads/2018/03/stmoritz13.jpg?v2&cache=' + (new Date()).getTime() ),
        ('https://www.lifeofpix.com/wp-content/uploads/2018/03/stmoritz13.jpg?v3&cache=' + (new Date()).getTime() ),
        ('https://www.lifeofpix.com/wp-content/uploads/2018/03/stmoritz13.jpg?v4&cache=' + (new Date()).getTime() ),
    ];

    preloader.preloadImages($scope.imageLocations).then(
    function handleFinished() {
        $rootScope.isLoading = false;
        if ($rootScope.needGoToHome) {
            $state.go('home.list');
        }
        console.log('preloading success');
    },
    function handleFailed() {
        //Loading of at least one image failed.
        $rootScope.isLoading = false;
        if ($rootScope.needGoToHome) {
            $state.go('home.list');
        }
        console.log('Loading of pic failed.');
    },
    function handleProgress(event) {
        $scope.percentLoaded = event.percent;
        console.log('loading progress: ' + event.percent + '  ' + event.imageLocation);
    });

    $scope.CalaosApp = CalaosApp;
    $scope.signOut = function() {
        CalaosApp.signOut();

        $state.go('login');
    };

    $scope.goBack = function () {
        $window.history.back();
    };

    $scope.canGoBack = function () {
        if ($state.is('home.room') ||
            $state.is('audio.player') ||
            $state.is('security.camera'))
            return true;

        return false;
    };
}]);
