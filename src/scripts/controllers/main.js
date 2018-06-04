'use strict';

angular.module('calaosApp')
.controller('MainCtrl', ['$rootScope', '$scope', '$state', 'CalaosApp', '$window', 'preloader', '$http', function ($rootScope, $scope, $state, CalaosApp, $window, preloader, $http) {

    $rootScope.isLoading = true;
    $scope.loadPercent = 0;
    $scope.isBackgroundLoaded = false;

    $http.get('scripts/assets.json').then(function(res) {
        $scope.imageLocations = res.data;
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
                if (event.imageLocation.endsWith('images/background.png'))
                    $scope.isBackgroundLoaded = true;
            });
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
