var gulp = require('gulp'),
    gutil = require('gulp-util'),
    usemin = require('gulp-usemin'),
    uglify = require('gulp-uglify'),
    minifyCss = require('gulp-minify-css'),
    connect = require('gulp-connect'),
    imagemin = require('gulp-imagemin'),
    cache = require('gulp-cache'),
    minifyHtml = require('gulp-minify-html'),
    rev = require('gulp-rev'),
    concat = require('gulp-concat'),
    opn = require('opn'),
    ngAnnotate = require('gulp-ng-annotate'),
    jsonminify = require('gulp-jsonminify'),
    file = require('gulp-file'),
    del = require('del');

gulp.task('views', function () {
    return gulp.src('src/views/**/*.html')
        .pipe(minifyHtml({empty: true}))
        .pipe(gulp.dest('dist/views'));
});

gulp.task('usemin', function() {

    return gulp.src('src/*.html')
        .pipe(usemin({
            css: [minifyCss({
                advanced: false
            }), 'concat'],
            html: [minifyHtml({empty: true})],
//            js: [uglify({mangle: false})],
            js: [ngAnnotate(), uglify()],
            jsoldie: [uglify()],
            jsvendor: [uglify()],
            inlinejs: [uglify()],
            inlinecss: [minifyCss(), 'concat']
        }))
        .pipe(gulp.dest('dist'));
});

gulp.task('images', function () {
    return gulp.src('src/images/**/*')
        .pipe(cache(imagemin({ optimizationLevel: 3, progressive: true, interlaced: true })))
        .pipe(gulp.dest('dist/images'));
});

gulp.task('fonts', function () {
    return gulp.src([
        'src/fonts/Source_Sans_Pro/fonts/**/*',
        'src/fonts/Ubuntu/fonts/**/*',
        'src/bower_components/font-awesome/fonts/**/*'])
        .pipe(gulp.dest('dist/fonts'));
});

gulp.task('reload', function () {
  return gulp.src('src/**/**.*')
    .pipe(connect.reload());
});

gulp.task('connect', function (done) {
  connect.server({
    root: 'src',
    port: 8000,
    livereload: true
  });
  opn('http://localhost:8000', done);
});

gulp.task('watch', function () {
  gulp.watch('src/**/**.*', ['reload']);
});

gulp.task('clean', function (cb) {
    del(['dist'], cb);
});

gulp.task('devjs', function (cb) {
    //create a correct dev_config.js file for deployment
    return file('dev_config.js', "var calaosDevConfig = { calaosServerHost: '' };")
        .pipe(gulp.dest('dist/scripts'));
});

gulp.task('serve', ['connect', 'watch']);
gulp.task('build', ['usemin', 'images', 'fonts', 'views', 'devjs']);

gulp.task('default', ['clean'], function () {
    gulp.start('build');
});
