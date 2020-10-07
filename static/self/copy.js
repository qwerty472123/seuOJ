$(function (){
    $("pre").prepend("<a class=\"copy-button ui tiny button\" style=\"position: absolute;top: -1px;right: -7px;border-top-left-radius: 0px;border-bottom-right-radius: 0px\">复制</a>");
    $(".copy-button").click(function() {
        var element = $(this).siblings("code");
        var text = $(element).text();
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text);
        } else {
            var $temp = $("<textarea>");
            $("body").append($temp);
            $temp.val(text).select();
            document.execCommand("copy");
            $temp.remove();
        }
        $(this).text("复制成功");
        var e = this;
        setTimeout(function() {
            $(e).text("复制");
        }, 500);
    });
});