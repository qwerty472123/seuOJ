$(function (){
    if (!$(".copy-button").length) {
        $(".ui.segment > pre").parent().prepend("<a class=\"copy-button ui tiny button\" style=\"position: absolute;top: 0;right: -4px;border-top-left-radius: 0px;border-bottom-right-radius: 0px\">复制</a>");
    }
    $(".copy-button").click(function() {
        var dataFor = $(this).attr('data-for');
        var element = dataFor ? $(dataFor) : $(this).siblings("pre").find("code");
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
        var e = $(this).addClass('green').text('成功');
        setTimeout(function() {
            e.removeClass('green').text('复制');
        }, 500);
    });
});